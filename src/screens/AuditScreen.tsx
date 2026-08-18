/**
 * The audit trail.
 *
 * This screen exists because of what the backend already does, not to add a feature: every session
 * this app opens and every control grant it requests is written to an append-only log before it
 * reaches the agent. Letting the operator read that log from the same device they act from is what
 * makes the audit claim checkable rather than a promise in a doc (spec §13).
 *
 * Control events are the only ones tinted with the alarm colour. A log where everything is
 * highlighted highlights nothing, and "remote control enabled" is the line an auditor scans for.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { auditTone, listAudit, type AuditEvent } from '../api/audit';
import { ApiError } from '../api/client';
import { Button } from '../components/Button';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconMenu, IconShield } from '../components/Icons';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { describeError } from '../utils/logger';

export type AuditScreenProps = {
  onOpenMenu: () => void;
};

export function AuditScreen({ onOpenMenu }: AuditScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  /**
   * No polling here, unlike the device list. An audit log is a record, not live state — and a log
   * that reshuffles under the reader's thumb every five seconds is actively hostile to the one thing
   * it is for. Pull to refresh instead.
   */
  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mode === 'initial') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const next = await listAudit(controller.signal);
      if (!controller.signal.aborted) {
        setEvents(next);
        setError('');
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      // A revoked session is handled globally by the auth context.
      if (err instanceof ApiError && err.status === 401) {
        return;
      }
      setError(describeError(err, 'Could not load the audit trail.'));
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

  const controlCount = useMemo(
    () => events.filter(event => auditTone(event) === 'control').length,
    [events],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: AuditEvent; index: number }) => (
      <Reveal index={index}>
        <AuditRow event={item} />
      </Reveal>
    ),
    [],
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
              Append-only log
            </Eyebrow>
            <Text style={styles.title}>Audit trail</Text>
          </View>
        </View>
        <Text style={styles.subtitle}>
          {controlCount > 0
            ? `${events.length} recent events · ${controlCount} involving remote control`
            : `${events.length} recent events`}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.coral} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <IconShield size={28} color={withAlpha(theme.colors.muted, 0.5)} />
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
          data={events}
          keyExtractor={(item, index) => `${item.time}-${item.action}-${index}`}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + theme.space.xxl },
            events.length === 0 && styles.listEmpty,
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
              <IconShield size={28} color={withAlpha(theme.colors.muted, 0.5)} />
              <Text style={styles.emptyText}>
                Nothing recorded yet. Sessions and control changes will appear here.
              </Text>
            </View>
          }
          initialNumToRender={14}
          windowSize={7}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

function Separator() {
  const styles = useThemedStyles(makeStyles);
  return <View style={styles.separator} />;
}

function AuditRow({ event }: { event: AuditEvent }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const tone = auditTone(event);

  const accent =
    tone === 'control'
      ? theme.colors.coral
      : tone === 'session'
        ? theme.colors.lime
        : tone === 'auth'
          ? theme.colors.amber
          : theme.colors.muted;

  return (
    <View style={[styles.row, tone === 'control' && { borderColor: withAlpha(accent, 0.28) }]}>
      {/* A colour spine rather than a badge: it aligns down the list so a run of control events is
          visible as a block while scrolling fast. */}
      <View style={[styles.spine, { backgroundColor: accent }]} />
      <View style={styles.rowBody}>
        <Text style={styles.action} numberOfLines={2}>
          {event.action}
        </Text>
        <View style={styles.rowMeta}>
          <Readout size={10} color={theme.colors.faint}>
            {event.time}
          </Readout>
          {event.user ? (
            <>
              <View style={styles.metaDot} />
              <Readout size={10} color={theme.colors.muted} numberOfLines={1}>
                {event.user}
              </Readout>
            </>
          ) : null}
          {event.device ? (
            <>
              <View style={styles.metaDot} />
              <Readout size={10} color={theme.colors.faint} numberOfLines={1}>
                {event.device}
              </Readout>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  header: {
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.lg,
    gap: theme.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
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
    gap: theme.space.xxs,
  },
  title: {
    ...type.title,
    fontSize: 26,
    lineHeight: 30,
    color: theme.colors.paper,
  },
  subtitle: {
    ...type.caption,
    color: theme.colors.muted,
  },
  list: {
    padding: theme.space.xl,
  },
  listEmpty: {
    flexGrow: 1,
  },
  separator: {
    height: theme.space.sm,
  },
  row: {
    flexDirection: 'row' as const,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
    overflow: 'hidden' as const,
  },
  spine: {
    width: 3,
  },
  rowBody: {
    flex: 1,
    padding: theme.space.md,
    gap: theme.space.xs,
  },
  action: {
    ...type.body,
    fontSize: 14,
    color: theme.colors.paper,
  },
  rowMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    flexWrap: 'wrap' as const,
  },
  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: theme.colors.faint,
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
