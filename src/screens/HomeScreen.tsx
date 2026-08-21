/**
 * Home — the fleet overview.
 *
 * One request builds this entire screen (`GET /api/stats/overview`), which is the reason it is the
 * landing screen rather than the device list: on a cellular link the number of round trips is what
 * decides whether opening the app feels instant, and this is the only endpoint that answers "is
 * anything wrong?" in a single hop.
 *
 * The screen deliberately does NOT poll. The device list polls every 5s because an operator watching
 * it is waiting for a machine to come up; this screen aggregates four Postgres subqueries plus a
 * 7-day GROUP BY, and running that every five seconds from every phone in the field is load the
 * answer does not justify. Pull to refresh, or navigate away and back — drawer navigation resets the
 * stack, so returning here remounts and refetches.
 *
 * Two numbers on this screen are already computed server-side and must not be re-derived: the
 * availability percentage, and each activity bar's height. See src/api/stats.ts for why plotting the
 * raw event count instead of `value` would flatten the chart.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '../api/client';
import { getOverview, type ActivityDay, type Overview } from '../api/stats';
import { Button } from '../components/Button';
import { Eyebrow, Readout } from '../components/Eyebrow';
import { IconAlert, IconMenu, IconMonitor } from '../components/Icons';
import { DeviceCard } from '../components/DeviceCard';
import { Meter } from '../components/Meter';
import { Pressable } from '../components/Pressable';
import { Reveal } from '../components/Reveal';
import { duration, easing, type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import type { Device } from '../types/device';
import { displayName } from '../types/user';
import { useAuth } from '../state/AuthContext';
import { describeError } from '../utils/logger';

/**
 * Chart height in points, fixed rather than flexed.
 *
 * The bars need a pixel height to animate on `scaleY` — React Native has no transform-origin, so
 * growing a bar from its base requires knowing its height to offset by. A percentage height inside a
 * flexed parent would render but could only be animated on the JS thread.
 */
const CHART_HEIGHT = 132;

export type HomeScreenProps = {
  onOpenMenu: () => void;
  onOpenDevice: (device: Device) => void;
  /** Feeds the drawer's fleet counts, so it never runs a poll of its own. */
  onFleetChange?: (fleet: { online: number; total: number }) => void;
};

export function HomeScreen({ onOpenMenu, onOpenDevice, onFleetChange }: HomeScreenProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const next = await getOverview(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        setOverview(next);
        setError('');
        onFleetChange?.({ online: next.kpis.onlineNow, total: next.kpis.totalEndpoints });
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }
        // A revoked session unmounts this whole stack from the auth context; showing a
        // per-screen error for it would flash under the login screen on the way out.
        if (err instanceof ApiError && err.status === 401) {
          return;
        }
        setError(describeError(err, 'Could not load the fleet overview.'));
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [onFleetChange],
  );

  useEffect(() => {
    void load('initial');
    return () => abortRef.current?.abort();
  }, [load]);

  const kpis = overview?.kpis;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + theme.space.lg }]}>
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
            Fleet overview
          </Eyebrow>
          {/* Greeting the operator by the name the BACKEND holds, not a local nickname: this is the
              same string it stamps into the remote desktop's consent notice, so seeing it here means
              seeing what the person at the other keyboard will read. */}
          <Text style={styles.title} numberOfLines={1}>
            {displayName(user) ? `Hello, ${firstName(displayName(user))}` : 'Overview'}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.colors.coral} />
        </View>
      ) : error && !overview ? (
        <View style={styles.center}>
          <IconAlert size={28} color={withAlpha(theme.colors.muted, 0.5)} />
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
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + theme.space.xxl },
          ]}
          showsVerticalScrollIndicator={false}
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
        >
          {/* A refresh that failed while stale data is on screen: keep the data, say so quietly.
              Replacing a readable screen with an error because one poll failed is worse than
              showing numbers with a caveat. */}
          {error ? (
            <Reveal>
              <View style={styles.staleBanner}>
                <IconAlert size={13} color={theme.colors.amber} />
                <Text style={styles.staleText}>{error}</Text>
              </View>
            </Reveal>
          ) : null}

          <Reveal index={0}>
            <View style={styles.kpiGrid}>
              <Kpi
                label="Endpoints"
                value={kpis?.totalEndpoints ?? 0}
                detail="enrolled"
                accent={theme.colors.coral}
              />
              <Kpi
                label="Online now"
                value={kpis?.onlineNow ?? 0}
                detail={`${kpis?.availabilityPct ?? 0}% availability`}
                accent={theme.colors.lime}
              />
              <Kpi
                label="Offline"
                value={kpis?.offline ?? 0}
                detail="not reporting"
                accent={theme.colors.amber}
              />
              <Kpi
                label="Sessions"
                value={kpis?.activeSessions ?? 0}
                detail="live now"
                accent={theme.colors.ember}
              />
            </View>
          </Reveal>

          <Reveal index={1}>
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <Eyebrow size={9} color={theme.colors.muted} tracking={0.22}>
                  Fleet availability
                </Eyebrow>
                <Readout size={13} bold color={theme.colors.paper}>
                  {kpis?.availabilityPct ?? 0}%
                </Readout>
              </View>
              {/* The same load bar the device cards use, so "how full is this" reads identically
                  whether it is one machine's RAM or the whole fleet's uptime. */}
              <Meter value={kpis?.availabilityPct ?? 0} height={6} />
              <Text style={styles.cardNote}>
                {kpis
                  ? `${kpis.onlineNow} of ${kpis.totalEndpoints} endpoint${
                      kpis.totalEndpoints === 1 ? '' : 's'
                    } reporting in.`
                  : ''}
              </Text>
            </View>
          </Reveal>

          <Reveal index={2}>
            <ActivityChart days={overview?.activity ?? []} />
          </Reveal>

          <Reveal index={3}>
            <View style={styles.section}>
              <View style={styles.cardHead}>
                <Eyebrow size={9} color={theme.colors.muted} tracking={0.22}>
                  Recently seen
                </Eyebrow>
                <Readout size={10} color={theme.colors.faint}>
                  {overview?.recentDevices.length ?? 0}
                </Readout>
              </View>
              {overview && overview.recentDevices.length > 0 ? (
                <View style={styles.deviceList}>
                  {overview.recentDevices.map(device => (
                    <DeviceCard key={device.id} device={device} onPress={onOpenDevice} />
                  ))}
                </View>
              ) : (
                <View style={styles.emptyCard}>
                  <IconMonitor size={22} color={withAlpha(theme.colors.muted, 0.5)} />
                  <Text style={styles.emptyText}>
                    No devices have reported in yet. Enroll an agent from the console and it will
                    appear here.
                  </Text>
                </View>
              )}
            </View>
          </Reveal>
        </ScrollView>
      )}
    </View>
  );
}

/** firstName keeps the greeting to one word — a full "Firstname Lastname" wraps the title line. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function Kpi({
  label,
  value,
  detail,
  accent,
}: {
  label: string;
  value: number;
  detail: string;
  accent: string;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.kpi, { borderColor: withAlpha(accent, 0.22) }]}>
      <Eyebrow size={8} color={accent} tracking={0.22}>
        {label}
      </Eyebrow>
      <Text style={styles.kpiValue}>{value}</Text>
      <Readout size={10} color={theme.colors.faint} numberOfLines={1}>
        {detail}
      </Readout>
    </View>
  );
}

/**
 * The 7-day audit-event chart.
 *
 * `value` is plotted, `count` is labelled — the backend normalized the former against the busiest
 * day and floored it so a quiet day is still visible. The busiest bar is tinted to give the row a
 * reference point; without it, a normalized chart has no indication of scale at all.
 */
function ActivityChart({ days }: { days: ActivityDay[] }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const total = days.reduce((sum, day) => sum + day.count, 0);
  const busiest = days.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Eyebrow size={9} color={theme.colors.muted} tracking={0.22}>
          7-day activity
        </Eyebrow>
        <Readout size={10} color={theme.colors.faint}>
          {total} event{total === 1 ? '' : 's'}
        </Readout>
      </View>

      {days.length === 0 ? (
        <Text style={styles.cardNote}>No activity recorded in the last seven days.</Text>
      ) : (
        <>
          <View style={styles.chart}>
            {days.map((day, index) => (
              <View key={`${day.day}-${index}`} style={styles.chartColumn}>
                <View style={styles.chartTrack}>
                  <Bar
                    height={Math.max(2, Math.round((CHART_HEIGHT * clampPercent(day.value)) / 100))}
                    index={index}
                    peak={day.count > 0 && day.count === busiest}
                  />
                </View>
                <Readout size={9} color={theme.colors.faint}>
                  {day.day.trim()}
                </Readout>
              </View>
            ))}
          </View>
          <Text style={styles.cardNote}>
            Audit events per day, oldest first. Bars are scaled to the busiest day
            {busiest > 0 ? ` (${busiest})` : ''}.
          </Text>
        </>
      )}
    </View>
  );
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

/**
 * One bar, growing from its base.
 *
 * React Native has no transform-origin, so scaling from the bottom is the standard
 * translate → scale → translate-back sandwich around the bar's own half-height. It is done this way
 * rather than animating `height` because height is a layout property and cannot run on the native
 * driver — and seven simultaneous JS-thread animations on a screen that has just finished a network
 * request is exactly when a dropped frame is most visible.
 */
function Bar({ height, index, peak }: { height: number; index: number; peak: boolean }) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const grow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(grow, {
      toValue: 1,
      duration: duration.slow,
      // Staggered left to right, so the row reads as a sequence of days rather than a block
      // appearing at once. The same 55ms step the Reveal list entrance uses.
      delay: 120 + index * 55,
      easing: easing.standard,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [grow, index]);

  return (
    <Animated.View
      style={[
        styles.bar,
        {
          height,
          backgroundColor: peak ? theme.colors.coral : withAlpha(theme.colors.ember, 0.5),
          transform: [{ translateY: height / 2 }, { scaleY: grow }, { translateY: -height / 2 }],
        },
      ]}
    />
  );
}

const makeStyles = (theme: Theme) => ({
  root: {
    flex: 1,
    backgroundColor: theme.colors.ink,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
    paddingHorizontal: theme.space.xl,
    paddingBottom: theme.space.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.hairline,
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
  scroll: {
    padding: theme.space.xl,
    gap: theme.space.lg,
  },
  staleBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.amber, 0.3),
    backgroundColor: withAlpha(theme.colors.amber, 0.08),
  },
  staleText: {
    ...type.caption,
    flex: 1,
    color: theme.colors.amber,
  },
  kpiGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: theme.space.md,
  },
  kpi: {
    // Two per row: half the width minus half the gap. Written as a percentage so it holds on a
    // tablet without a second layout pass.
    flexBasis: '47.5%' as const,
    flexGrow: 1,
    gap: theme.space.xs,
    padding: theme.space.lg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    backgroundColor: theme.colors.coal,
  },
  kpiValue: {
    ...type.title,
    fontSize: 28,
    lineHeight: 32,
    color: theme.colors.paper,
  },
  card: {
    gap: theme.space.md,
    padding: theme.space.lg,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
  },
  cardHead: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: theme.space.md,
  },
  cardNote: {
    ...type.caption,
    fontSize: 12,
    lineHeight: 17,
    color: theme.colors.faint,
  },
  chart: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: theme.space.sm,
    // No height here on purpose: chartTrack is the fixed-height element, so the row sizes itself
    // from the track plus the day label. A fixed height on the row clips the label at larger
    // system font scales, which is exactly where a hard-coded total goes wrong.
  },
  chartColumn: {
    flex: 1,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  chartTrack: {
    width: '100%' as const,
    height: CHART_HEIGHT,
    justifyContent: 'flex-end' as const,
  },
  bar: {
    width: '100%' as const,
    borderTopLeftRadius: theme.radius.xs,
    borderTopRightRadius: theme.radius.xs,
  },
  section: {
    gap: theme.space.md,
  },
  deviceList: {
    gap: theme.space.md,
  },
  emptyCard: {
    alignItems: 'center' as const,
    gap: theme.space.md,
    padding: theme.space.xl,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.coal,
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
