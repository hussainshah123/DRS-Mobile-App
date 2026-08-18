/**
 * The fleet.
 *
 * Polls `GET /api/devices` every 5s, matching the dashboard's cadence, so a device coming online
 * appears without a manual refresh. The poll is SILENT: it never shows the loading state or
 * replaces the list with an error, because a screen that flashes a spinner every five seconds is
 * unusable. Only the first load and an explicit pull-to-refresh are allowed to take the screen
 * over.
 *
 * A failed silent poll keeps the last good list and shows a thin banner. That is the right trade
 * for a mobile client: an operator on a patchy connection still wants to see the fleet they were
 * looking at a moment ago, with a note that it may be stale.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listDevices } from '../api/devices';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { DeviceCard } from '../components/DeviceCard';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconMenu, IconMonitor, IconSearch } from '../components/Icons';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { DEVICE_POLL_MS } from '../config/env';
import { useAuth } from '../state/AuthContext';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { deviceTitle, isOnline, type Device } from '../types/device';
import { canOpenSession, displayName } from '../types/user';
import { describeError } from '../utils/logger';

type Filter = 'all' | 'online' | 'offline';
const FILTERS: Filter[] = ['all', 'online', 'offline'];

/**
 * Row spacer. Hoisted out of the screen because an inline arrow is a fresh component TYPE on every
 * render: React would tear down and rebuild every separator each time the 5s poll lands.
 */
function Separator() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.separator} />;
}

export type DevicesScreenProps = {
  onOpenDevice: (device: Device) => void;
  onOpenMenu: () => void;
  /**
   * Reports the fleet counts upward so the drawer can show them without running a SECOND poll of
   * /api/devices. Two independent 5s polls against the same endpoint is the kind of waste that only
   * shows up as battery drain on someone else's phone.
   */
  onFleetChange?: (fleet: { online: number; total: number }) => void;
};

export function DevicesScreen({ onOpenDevice, onOpenMenu, onFleetChange }: DevicesScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  /** Set when a poll fails but we still hold a usable list. */
  const [stale, setStale] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  // One controller per screen lifetime, aborted on unmount, so an in-flight poll cannot call
  // setState after teardown.
  const abortRef = useRef<AbortController | null>(null);
  /**
   * Whether we currently hold a usable list, read inside `load` without being a dependency of it.
   * If `load` depended on `devices.length` it would get a new identity on every refresh, which
   * would tear down and re-arm the poll interval each time — resetting the 5s clock and, on a
   * slow backend, effectively never firing.
   */
  const hasDataRef = useRef(false);

  const load = useCallback(async (mode: 'initial' | 'silent' | 'refresh') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (mode === 'initial') {
      setLoading(true);
    }
    if (mode === 'refresh') {
      setRefreshing(true);
    }

    try {
      const next = await listDevices(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      setDevices(next);
      hasDataRef.current = true;
      setError('');
      setStale(false);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      // A revoked session is handled globally by the auth context (it signs out and shows the
      // reason on the login screen), so it must not also be reported here.
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      const message = describeError(err, 'Could not load devices.');
      if (mode === 'silent' && hasDataRef.current) {
        setStale(true);
      } else {
        setError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load('initial');
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load('silent');
    }, DEVICE_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return devices.filter(device => {
      const matchesFilter =
        filter === 'all' || (filter === 'online' ? isOnline(device) : !isOnline(device));
      if (!matchesFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      // Search the fields an operator would actually recall: what it's called, who has it, and
      // its address.
      return [device.label, device.name, device.user, device.os, device.ip]
        .filter(Boolean)
        .some(field => field.toLowerCase().includes(needle));
    });
  }, [devices, filter, query]);

  const onlineCount = useMemo(() => devices.filter(isOnline).length, [devices]);
  const mayConnect = canOpenSession(user);

  // Push the counts up whenever they change, so the drawer reads them instead of re-fetching.
  useEffect(() => {
    onFleetChange?.({ online: onlineCount, total: devices.length });
  }, [devices.length, onFleetChange, onlineCount]);

  const renderItem = useCallback(
    ({ item, index }: { item: Device; index: number }) => (
      <Reveal index={index}>
        <DeviceCard device={item} onPress={onOpenDevice} />
      </Reveal>
    ),
    [onOpenDevice],
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + theme.space.lg }]}>
        <View style={styles.headerTop}>
          <Pressable
            style={styles.menu}
            onPress={onOpenMenu}
            accessibilityRole="button"
            accessibilityLabel="Open menu"
          >
            <IconMenu size={18} color={theme.colors.paper} />
          </Pressable>
          <View style={styles.headerText}>
            <Eyebrow size={9} color={theme.colors.lime} tracking={0.26}>
              DRS Fleet
            </Eyebrow>
            <Text style={styles.title}>Devices</Text>
          </View>
        </View>

        <View style={styles.identity}>
          <Readout size={11} color={theme.colors.muted} numberOfLines={1}>
            {displayName(user)}
          </Readout>
          <View style={styles.dotSeparator} />
          <Eyebrow size={9} color={theme.colors.faint} tracking={0.18}>
            {user?.role ?? '—'}
          </Eyebrow>
          <View style={styles.dotSeparator} />
          <Readout size={11} color={theme.colors.lime}>
            {onlineCount}/{devices.length} online
          </Readout>
        </View>

        {/*
          Role notice. /ws/session rejects any non-admin token before the upgrade, so a plain
          user's Connect would fail with an opaque socket error. Saying so up front is more
          honest than letting them find out per device.
        */}
        {!mayConnect && !loading ? (
          <View style={styles.roleNotice}>
            <Text style={styles.roleNoticeText}>
              Your account can view the fleet but not open remote sessions. An administrator role
              is required to connect.
            </Text>
          </View>
        ) : null}

        <View style={styles.searchRow}>
          <IconSearch size={16} color={theme.colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search hostname, user, IP…"
            placeholderTextColor={theme.colors.faint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            keyboardAppearance={theme.isDark ? 'dark' : 'light'}
            style={styles.search}
          />
        </View>

        <View style={styles.filters}>
          {FILTERS.map(item => {
            const active = filter === item;
            return (
              <Pressable
                key={item}
                style={[
                  styles.filter,
                  active && {
                    backgroundColor: theme.colors.coral,
                    borderColor: theme.colors.coral,
                  },
                ]}
                onPress={() => setFilter(item)}
                scaleTo={0.94}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Eyebrow size={9} color={active ? theme.colors.ink : theme.colors.muted} tracking={0.18}>
                  {item}
                </Eyebrow>
              </Pressable>
            );
          })}
        </View>

        {stale ? (
          <View style={styles.staleBanner}>
            <Text style={styles.staleText}>
              Could not refresh — showing the last known state of the fleet.
            </Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.coral} />
          <Eyebrow size={9} color={theme.colors.muted} tracking={0.2}>
            Loading the fleet
          </Eyebrow>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <IconMonitor size={30} color={withAlpha(theme.colors.muted, 0.5)} />
          <Text style={styles.emptyText}>{error}</Text>
          <Button
            label="Try again"
            intent="secondary"
            onPress={() => {
              void load('initial');
            }}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + theme.space.xxl },
            filtered.length === 0 && styles.listEmpty,
          ]}
          ItemSeparatorComponent={Separator}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                void load('refresh');
              }}
              tintColor={theme.colors.coral}
              colors={[theme.colors.coral]}
              progressBackgroundColor={theme.colors.coal}
            />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <IconMonitor size={30} color={withAlpha(theme.colors.muted, 0.5)} />
              <Text style={styles.emptyText}>
                {devices.length === 0
                  ? 'No devices are enrolled yet. Enroll one from the DRS console.'
                  : `No ${filter === 'all' ? '' : `${filter} `}devices match “${query}”.`}
              </Text>
            </View>
          }
          // Windowing tuned for cards this tall: 8 fills two screens, so scrolling is smooth
          // without mounting the whole fleet.
          initialNumToRender={8}
          windowSize={5}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

/** Exported for the details screen's header, so the two spell a device's name identically. */
export { deviceTitle };

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  header: {
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.lg,
    gap: theme.space.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
    backgroundColor: theme.colors.ink,
  },
  headerTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
  },
  menu: {
    padding: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
  },
  headerText: {
    flex: 1,
    gap: theme.space.xs,
  },
  title: {
    ...type.title,
    color: theme.colors.paper,
  },
  identity: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    flexWrap: 'wrap' as const,
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.colors.faint,
  },
  roleNotice: {
    backgroundColor: withAlpha(theme.colors.amber, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.amber, 0.28),
    borderRadius: theme.radius.md,
    padding: theme.space.md,
  },
  roleNoticeText: {
    ...type.caption,
    color: theme.colors.amber,
  },
  searchRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    backgroundColor: theme.colors.coal,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
  },
  search: {
    ...type.body,
    flex: 1,
    color: theme.colors.paper,
    paddingVertical: theme.space.md,
  },
  filters: {
    flexDirection: 'row' as const,
    gap: theme.space.sm,
  },
  filter: {
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
  },
  staleBanner: {
    backgroundColor: withAlpha(theme.colors.amber, 0.08),
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  staleText: {
    ...type.caption,
    fontSize: 12,
    color: theme.colors.amber,
  },
  list: {
    padding: theme.space.xl,
  },
  listEmpty: {
    flexGrow: 1,
  },
  separator: {
    height: theme.space.md,
  },
  center: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.space.md,
    padding: theme.space.xxl,
  },
  emptyText: {
    ...type.body,
    color: theme.colors.muted,
    textAlign: 'center' as const,
  },
});
