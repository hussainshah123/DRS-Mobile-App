/**
 * The session status chip.
 *
 * This is the audit-facing element of the session screen (spec §13: "display the remote device
 * name and current session/control state"). It has to be unambiguous at a glance about one
 * thing above all: whether input is currently reaching someone else's desktop.
 *
 * So CONTROLLING is the only state rendered in coral, and it is the only one that says the word
 * — every other state, including a healthy live view, is lime or muted. An operator glancing at
 * the screen should never have to work out whether they are driving.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { ControlState, SessionState, isBusy } from '../types/session';
import { Eyebrow } from './Eyebrow';
import { StatusDot } from './StatusDot';

export type ConnectionStatusProps = {
  state: SessionState;
  control: ControlState;
  /** Compact form for the header bar; full form for the overlay watermark. */
  compact?: boolean;
  /** True while local input is suppressed on the device. */
  lockLocal?: boolean;
  style?: StyleProp<ViewStyle>;
};

type Descriptor = { label: string; tone: 'live' | 'control' | 'warn' | 'bad' | 'idle'; pulse: boolean };

/**
 * describe maps the machine state to what the operator reads. Control takes priority over
 * transport state: once input is flowing, that is the most important fact on the screen.
 */
export function describe(state: SessionState, control: ControlState): Descriptor {
  if (state === SessionState.CONTROLLING && control === ControlState.ENABLED) {
    return { label: 'Controlling', tone: 'control', pulse: true };
  }
  switch (state) {
    case SessionState.VIEWING:
      return control === ControlState.REQUESTED
        ? { label: 'Control pending', tone: 'warn', pulse: true }
        : { label: 'Live · view only', tone: 'live', pulse: true };
    case SessionState.CONTROLLING:
      return { label: 'Control pending', tone: 'warn', pulse: true };
    case SessionState.STARTING:
      return { label: 'Starting', tone: 'warn', pulse: true };
    case SessionState.SIGNALING:
      return { label: 'Waiting for device', tone: 'warn', pulse: true };
    case SessionState.CONNECTING:
      return { label: 'Connecting', tone: 'warn', pulse: true };
    case SessionState.RECONNECTING:
      return { label: 'Reconnecting', tone: 'warn', pulse: true };
    case SessionState.STOPPING:
      return { label: 'Ending', tone: 'idle', pulse: false };
    case SessionState.ERROR:
      return { label: 'Failed', tone: 'bad', pulse: false };
    default:
      return { label: 'Idle', tone: 'idle', pulse: false };
  }
}

export function ConnectionStatus({
  state,
  control,
  compact = false,
  lockLocal = false,
  style,
}: ConnectionStatusProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const descriptor = describe(state, control);

  const color =
    descriptor.tone === 'control'
      ? theme.colors.coral
      : descriptor.tone === 'live'
        ? theme.colors.lime
        : descriptor.tone === 'warn'
          ? theme.colors.amber
          : descriptor.tone === 'bad'
            ? theme.colors.coral
            : theme.colors.muted;

  const label = lockLocal && descriptor.tone === 'control' ? 'Controlling · input locked' : descriptor.label;

  return (
    <View
      style={[
        styles.chip,
        compact && styles.chipCompact,
        { borderColor: withAlpha(color, 0.3), backgroundColor: withAlpha(color, 0.1) },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Session status: ${label}`}
    >
      <StatusDot color={color} size={compact ? 6 : 7} pulse={descriptor.pulse} />
      <Eyebrow size={compact ? 9 : 10} color={color} tracking={0.2} numberOfLines={1}>
        {label}
      </Eyebrow>
    </View>
  );
}

/** busyLabel gives the spinner overlay its caption, naming what is being waited on. */
export function busyLabel(state: SessionState, deviceName: string): string {
  switch (state) {
    case SessionState.STARTING:
      return 'Requesting connection details…';
    case SessionState.SIGNALING:
      return `Waiting for ${deviceName} to start streaming…`;
    case SessionState.CONNECTING:
      return 'Negotiating a peer-to-peer connection…';
    case SessionState.RECONNECTING:
      return 'Connection interrupted — trying to recover…';
    default:
      return isBusy(state) ? 'Connecting…' : '';
  }
}

const makeStyles = (theme: Theme) => ({
  chip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: 7,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start' as const,
  },
  chipCompact: {
    paddingHorizontal: theme.space.sm + 2,
    paddingVertical: 5,
    gap: 6,
  },
});
