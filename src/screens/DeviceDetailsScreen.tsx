/**
 * Device details — the pre-flight screen.
 *
 * Its real job is to make sure the operator knows exactly what they are about to do before a
 * session starts, because starting one is not a private act: the backend audits it, and the
 * device shows an on-screen notice naming the operator. So this screen states both facts before
 * the button, not after.
 *
 * It offers two entries into the same session, differing only in the intent it carries:
 *
 *   Start view      → connect, stay view-only
 *   Start control   → connect and immediately request the input_control grant
 *
 * Both open the SAME session in the same way — there is one path to a session, and it is opening
 * the WebSocket. "Start control" does not use a different endpoint or a privileged mode; it simply
 * asks for the grant as soon as the transport can carry it, still through the backend, still
 * audited.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDevice } from '../api/devices';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconChevronLeft, IconCursor, IconEye, IconShield, platformIcon } from '../components/Icons';
import { Meter } from '../components/Meter';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { StatusDot } from '../components/StatusDot';
import { DEVICE_POLL_MS } from '../config/env';
import { useAuth } from '../state/AuthContext';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { deviceSubtitle, deviceTitle, isOnline, platformOf, type Device } from '../types/device';
import { canOpenSession, displayName } from '../types/user';
import { describeError } from '../utils/logger';

export type DeviceDetailsScreenProps = {
  device: Device;
  onBack: () => void;
  onStartSession: (device: Device, withControl: boolean) => void;
};

export function DeviceDetailsScreen({ device: initial, onBack, onStartSession }: DeviceDetailsScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Seeded from the list so the screen renders instantly, then kept live by its own poll — the
  // online badge and the meters must be current at the moment Connect is tapped, not from
  // whenever the list last refreshed.
  const [device, setDevice] = useState<Device>(initial);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRefreshing(true);
    try {
      const next = await getDevice(initial.id, controller.signal);
      if (!controller.signal.aborted) {
        setDevice(next);
        setError('');
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      // 401 is handled globally by the auth context; a 404 means the device was removed while
      // this screen was open, which is worth saying plainly.
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      if (err instanceof ApiError && err.status === 404) {
        setError('This device is no longer enrolled.');
        return;
      }
      setError(describeError(err, 'Could not refresh this device.'));
    } finally {
      if (!controller.signal.aborted) {
        setRefreshing(false);
      }
    }
  }, [initial.id]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, DEVICE_POLL_MS);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [load]);

  const online = isOnline(device);
  const mayConnect = canOpenSession(user);
  const connectable = online && mayConnect && !error;
  const PlatformIcon = platformIcon(platformOf(device));
  const accent = online ? theme.colors.lime : theme.colors.muted;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + theme.space.sm }]}>
        <Pressable
          style={styles.back}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back to devices"
        >
          <IconChevronLeft size={20} color={theme.colors.paper} />
        </Pressable>
        <Eyebrow size={9} color={theme.colors.faint} tracking={0.22} numberOfLines={1}>
          Device
        </Eyebrow>
        {refreshing ? <ActivityIndicator size="small" color={theme.colors.muted} /> : <View style={styles.spacer} />}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + theme.space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <Reveal>
          <View style={styles.identity}>
            <View style={[styles.iconWell, online && styles.iconWellOnline]}>
              <PlatformIcon size={24} color={accent} />
            </View>
            <View style={styles.identityText}>
              <Text style={styles.title}>{deviceTitle(device)}</Text>
              <Readout size={12} color={theme.colors.muted} numberOfLines={1}>
                {deviceSubtitle(device) || device.os}
              </Readout>
            </View>
          </View>
        </Reveal>

        <Reveal index={1}>
          <View style={[styles.statusCard, online && styles.statusCardOnline]}>
            <View style={styles.statusRow}>
              <StatusDot color={accent} size={8} pulse={online} halo />
              <Eyebrow size={10} color={accent} tracking={0.22}>
                {online ? 'Agent online' : 'Agent offline'}
              </Eyebrow>
              <View style={styles.flex} />
              <Readout size={11} color={theme.colors.faint}>
                {device.last}
              </Readout>
            </View>
            <Text style={styles.statusCopy}>
              {online
                ? 'The device is holding a live connection to the DRS backend and can start a remote session.'
                : 'The device has no live agent connection. It must come online before a session can start.'}
            </Text>
          </View>
        </Reveal>

        <Reveal index={2}>
          <View style={styles.card}>
            <Eyebrow size={9} color={theme.colors.lime} tracking={0.24}>
              Live load
            </Eyebrow>
            <View style={styles.meters}>
              <View style={styles.meter}>
                <View style={styles.meterHead}>
                  <Eyebrow size={9} color={theme.colors.muted}>
                    CPU
                  </Eyebrow>
                  <Readout size={12} color={online ? theme.colors.paper : theme.colors.faint}>
                    {online ? `${device.cpu}%` : '—'}
                  </Readout>
                </View>
                <Meter value={online ? device.cpu : 0} height={5} inactive={!online} />
              </View>
              <View style={styles.meter}>
                <View style={styles.meterHead}>
                  <Eyebrow size={9} color={theme.colors.muted}>
                    Memory
                  </Eyebrow>
                  <Readout size={12} color={online ? theme.colors.paper : theme.colors.faint}>
                    {online ? `${device.ram}%` : '—'}
                  </Readout>
                </View>
                <Meter value={online ? device.ram : 0} height={5} inactive={!online} />
              </View>
            </View>
          </View>
        </Reveal>

        <Reveal index={3}>
          <View style={styles.card}>
            <Eyebrow size={9} color={theme.colors.lime} tracking={0.24}>
              Details
            </Eyebrow>
            <View style={styles.rows}>
              <Row label="Hostname" value={device.name || '—'} />
              <Row label="Operating system" value={device.os || '—'} />
              <Row label="IP address" value={device.ip || '—'} />
              <Row label="Assigned to" value={device.user || 'Unassigned'} />
              <Row label="Device ID" value={device.id} mono />
            </View>
          </View>
        </Reveal>

        {/*
          Consent + audit notice. The backend stamps the operator's name into StartSession.Operator
          from the JWT and the agent shows it on the device's screen; every session start/stop and
          every control change is written to the append-only audit log. Saying so BEFORE the button
          is the honest ordering, and it is the app's half of the spec's no-stealth-control rule
          (§13).
        */}
        <Reveal index={4}>
          <View style={styles.noticeCard}>
            <View style={styles.noticeHead}>
              <IconShield size={16} color={theme.colors.amber} />
              <Eyebrow size={9} color={theme.colors.amber} tracking={0.22}>
                Before you connect
              </Eyebrow>
            </View>
            <Text style={styles.noticeText}>
              {`This device will display a notice naming you — ${displayName(user) || 'this operator'} — for as long as you are connected, and it escalates when you take control. The session start, the session end, and every control change are written to the DRS audit log.`}
            </Text>
          </View>
        </Reveal>

        {error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!mayConnect ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>
              Opening a remote session requires an administrator role. Your account can view this
              device but not connect to it.
            </Text>
          </View>
        ) : null}

        <Reveal index={5} style={styles.actions}>
          <Button
            label="Start view"
            intent="secondary"
            block
            disabled={!connectable}
            onPress={() => onStartSession(device, false)}
            icon={
              <IconEye size={17} color={connectable ? theme.colors.paper : theme.colors.faint} />
            }
          />
          <Button
            label="Start control"
            block
            disabled={!connectable}
            onPress={() => onStartSession(device, true)}
            icon={<IconCursor size={17} color={theme.colors.ink} />}
          />
          <Text style={styles.actionHint}>
            Both open the same audited session. “Start control” additionally requests input
            authorization from the backend as soon as the stream is live — you can switch either way
            during the session.
          </Text>
        </Reveal>
      </ScrollView>
    </View>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.row}>
      <Eyebrow size={9} color={theme.colors.faint} tracking={0.16}>
        {label}
      </Eyebrow>
      {mono ? (
        <Readout size={10} color={theme.colors.muted} style={styles.rowValue} numberOfLines={1}>
          {value}
        </Readout>
      ) : (
        <Text style={[styles.rowText, styles.rowValue]} numberOfLines={1}>
          {value}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: theme.space.lg,
    paddingBottom: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
  },
  back: {
    padding: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  spacer: {
    width: 36,
  },
  scroll: {
    padding: theme.space.xl,
    gap: theme.space.lg,
  },
  identity: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.lg,
  },
  iconWell: {
    width: 54,
    height: 54,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: theme.colors.sand,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  iconWellOnline: {
    backgroundColor: withAlpha(theme.colors.lime, 0.1),
    borderColor: withAlpha(theme.colors.lime, 0.25),
  },
  identityText: {
    flex: 1,
    gap: theme.space.xs,
  },
  title: {
    ...type.title,
    fontSize: 26,
    lineHeight: 30,
    color: theme.colors.paper,
  },
  statusCard: {
    backgroundColor: theme.colors.coal,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.space.lg,
    gap: theme.space.md,
  },
  statusCardOnline: {
    borderColor: withAlpha(theme.colors.lime, 0.22),
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
  },
  statusCopy: {
    ...type.caption,
    color: theme.colors.muted,
  },
  card: {
    backgroundColor: theme.colors.coal,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.space.lg,
    gap: theme.space.lg,
  },
  meters: {
    gap: theme.space.lg,
  },
  meter: {
    gap: theme.space.sm,
  },
  meterHead: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  rows: {
    gap: theme.space.md,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.space.lg,
  },
  rowValue: {
    flex: 1,
    textAlign: 'right' as const,
  },
  rowText: {
    ...type.caption,
    fontSize: 13,
    color: theme.colors.paper,
  },
  noticeCard: {
    backgroundColor: withAlpha(theme.colors.amber, 0.08),
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.amber, 0.25),
    padding: theme.space.lg,
    gap: theme.space.sm,
  },
  noticeHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  noticeText: {
    ...type.caption,
    color: theme.colors.paper,
    opacity: 0.9,
  },
  errorBanner: {
    backgroundColor: withAlpha(theme.colors.coral, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.coral, 0.3),
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  errorText: {
    ...type.caption,
    color: theme.colors.coral,
  },
  actions: {
    gap: theme.space.md,
    marginTop: theme.space.xs,
  },
  actionHint: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.faint,
    textAlign: 'center' as const,
  },
});
