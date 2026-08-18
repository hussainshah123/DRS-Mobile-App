/**
 * One device in the fleet list.
 *
 * The card's job is to answer, at a glance and without a tap: can I connect to this, and is
 * anything wrong with it. So the online state is carried by three redundant cues — a pulsing
 * lime dot, a lime border tint, and the word ONLINE — because a single colour cue fails for a
 * colour-blind operator and in direct sunlight.
 *
 * An offline device stays tappable. The details screen explains WHY it cannot be connected to,
 * which is more useful than a dead row that ignores the touch.
 */
import React from 'react';
import { StyleProp, Text, View, ViewStyle } from 'react-native';

import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { deviceSubtitle, deviceTitle, isOnline, platformOf, type Device } from '../types/device';
import { Eyebrow, Readout } from './Eyebrow';
import { IconChevronRight, platformIcon } from './Icons';
import { Meter } from './Meter';
import { Pressable } from './Pressable';
import { StatusDot } from './StatusDot';

export type DeviceCardProps = {
  device: Device;
  onPress: (device: Device) => void;
  style?: StyleProp<ViewStyle>;
};

export function DeviceCard({ device, onPress, style }: DeviceCardProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const online = isOnline(device);
  const PlatformIcon = platformIcon(platformOf(device));
  const accent = online ? theme.colors.lime : theme.colors.muted;

  return (
    <Pressable
      style={[styles.card, online && styles.cardOnline, style]}
      onPress={() => onPress(device)}
      accessibilityRole="button"
      accessibilityLabel={`${deviceTitle(device)}, ${online ? 'online' : 'offline'}`}
    >
      <View style={styles.header}>
        <View style={[styles.iconWell, online && styles.iconWellOnline]}>
          <PlatformIcon size={18} color={online ? theme.colors.lime : theme.colors.muted} />
        </View>

        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>
            {deviceTitle(device)}
          </Text>
          <Readout size={11} color={theme.colors.faint} numberOfLines={1}>
            {deviceSubtitle(device) || device.os || '—'}
          </Readout>
        </View>

        <View style={styles.statusColumn}>
          <View style={styles.statusRow}>
            <StatusDot color={accent} size={7} pulse={online} />
            <Eyebrow size={9} color={accent} tracking={0.2}>
              {online ? 'Online' : 'Offline'}
            </Eyebrow>
          </View>
          <Readout size={10} color={theme.colors.faint}>
            {device.last}
          </Readout>
        </View>

        <IconChevronRight size={16} color={theme.colors.faint} />
      </View>

      {/* Metrics. The backend zeroes CPU/RAM when a device goes offline, so showing them for an
          offline machine would imply an idle desktop rather than an absent one. */}
      <View style={styles.metrics}>
        <View style={styles.metric}>
          <View style={styles.metricHead}>
            <Eyebrow size={9} color={theme.colors.faint}>
              CPU
            </Eyebrow>
            <Readout size={10} color={online ? theme.colors.paper : theme.colors.faint}>
              {online ? `${device.cpu}%` : '—'}
            </Readout>
          </View>
          <Meter value={online ? device.cpu : 0} inactive={!online} />
        </View>

        <View style={styles.metric}>
          <View style={styles.metricHead}>
            <Eyebrow size={9} color={theme.colors.faint}>
              RAM
            </Eyebrow>
            <Readout size={10} color={online ? theme.colors.paper : theme.colors.faint}>
              {online ? `${device.ram}%` : '—'}
            </Readout>
          </View>
          <Meter value={online ? device.ram : 0} inactive={!online} />
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => ({
  card: {
    backgroundColor: theme.colors.coal,
    borderRadius: theme.radius.card,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    padding: theme.space.lg,
    gap: theme.space.lg,
  },
  cardOnline: {
    borderColor: withAlpha(theme.colors.lime, 0.22),
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.md,
  },
  iconWell: {
    width: 38,
    height: 38,
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
  headerText: {
    flex: 1,
    gap: 3,
  },
  title: {
    ...type.heading,
    fontSize: 16,
    lineHeight: 20,
    color: theme.colors.paper,
  },
  statusColumn: {
    alignItems: 'flex-end' as const,
    gap: 4,
  },
  statusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
  },
  metrics: {
    flexDirection: 'row' as const,
    gap: theme.space.lg,
  },
  metric: {
    flex: 1,
    gap: 6,
  },
  metricHead: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
});
