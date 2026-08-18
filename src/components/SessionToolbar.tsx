/**
 * The session toolbar (spec §10): View · Control · Keyboard · Stop, plus the pointer-mode and
 * mouse-action controls a touchscreen needs.
 *
 * Ordering is a safety decision, not a layout one. Stop sits at the far right, separated, so it
 * is never adjacent to Control — the two most consequential buttons on the screen should not be
 * neighbours when the operator is working one-handed. View sits leftmost because it is the state
 * to fall BACK to, and falling back should be the easiest thing to reach.
 *
 * Control is disabled, with a reason, on the JPEG fallback: that transport has no data channel,
 * so control is genuinely impossible rather than merely unavailable.
 */
import React from 'react';
import { ScrollView, StyleProp, View, ViewStyle } from 'react-native';

import type { PointerMode } from '../remote-control/inputMapper';
import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { ControlState, SessionState, hasPicture } from '../types/session';
import { ControlButton } from './ControlButton';
import { Eyebrow } from './Eyebrow';
import {
  IconCursor,
  IconEye,
  IconKeyboard,
  IconLock,
  IconPower,
  IconScroll,
  IconTrackpad,
} from './Icons';

export type SessionToolbarProps = {
  state: SessionState;
  control: ControlState;
  lockLocal: boolean;
  pointerMode: PointerMode;
  keyboardOpen: boolean;
  dragHeld: boolean;
  onViewOnly: () => void;
  onRequestControl: () => void;
  onToggleLockLocal: () => void;
  onTogglePointerMode: () => void;
  onToggleKeyboard: () => void;
  onDoubleClick: () => void;
  onToggleDrag: () => void;
  onStop: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SessionToolbar({
  state,
  control,
  lockLocal,
  pointerMode,
  keyboardOpen,
  dragHeld,
  onViewOnly,
  onRequestControl,
  onToggleLockLocal,
  onTogglePointerMode,
  onToggleKeyboard,
  onDoubleClick,
  onToggleDrag,
  onStop,
  style,
}: SessionToolbarProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);

  const live = hasPicture(state);
  const controlPossible = control !== ControlState.UNAVAILABLE;
  const controlling = control === ControlState.ENABLED || control === ControlState.REQUESTED;
  const controlLive = control === ControlState.ENABLED;

  return (
    <View style={[styles.bar, style]}>
      {/* Horizontally scrollable so the row never truncates on a narrow phone in portrait —
          a control that is off-screen is a control that does not exist. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="always"
      >
        <ControlButton
          label="View"
          icon={IconEye}
          onPress={onViewOnly}
          active={!controlling && live}
          activeColor={theme.colors.lime}
          disabled={!live}
        />
        <ControlButton
          label="Control"
          icon={IconCursor}
          onPress={onRequestControl}
          active={controlling}
          disabled={!live || !controlPossible}
          cue={null}
        />

        <View style={styles.divider} />

        {/* Pointer mode. Only meaningful while controlling, but left enabled during a live view so
            the operator can pick their mode before taking control. */}
        <ControlButton
          label={pointerMode === 'touch' ? 'Direct' : 'Trackpad'}
          icon={pointerMode === 'touch' ? IconCursor : IconTrackpad}
          onPress={onTogglePointerMode}
          active={pointerMode === 'trackpad'}
          activeColor={theme.colors.amber}
          disabled={!live}
        />
        <ControlButton
          label={dragHeld ? 'Drop' : 'Drag'}
          icon={IconScroll}
          onPress={onToggleDrag}
          active={dragHeld}
          disabled={!controlLive}
        />
        <ControlButton label="2×Tap" icon={IconCursor} onPress={onDoubleClick} disabled={!controlLive} />
        <ControlButton
          label="Keyboard"
          icon={IconKeyboard}
          onPress={onToggleKeyboard}
          active={keyboardOpen}
          disabled={!controlLive}
        />
        <ControlButton
          label="Lock"
          icon={IconLock}
          onPress={onToggleLockLocal}
          active={lockLocal}
          disabled={!controlLive}
        />

        <View style={styles.divider} />

        <ControlButton
          label="Stop"
          icon={IconPower}
          onPress={onStop}
          activeColor={theme.colors.coral}
          style={styles.stop}
        />
      </ScrollView>

      {/* One line of context under the row, so the current mode is explained without a tap. */}
      <View style={styles.hint}>
        <Eyebrow size={9} color={theme.colors.faint} tracking={0.14} numberOfLines={1}>
          {hintFor(control, pointerMode, lockLocal)}
        </Eyebrow>
      </View>
    </View>
  );
}

/**
 * The one-line explanation under the toolbar. It names the gesture vocabulary, because a
 * touchscreen has no discoverable right-click and an operator who does not know about long-press
 * will conclude the feature is missing.
 */
function hintFor(control: ControlState, pointerMode: PointerMode, lockLocal: boolean): string {
  if (control === ControlState.UNAVAILABLE) {
    return 'View only — this session fell back to JPEG, which cannot carry remote control';
  }
  if (control === ControlState.REQUESTED) {
    return 'Authorizing control with the backend…';
  }
  if (control !== ControlState.ENABLED) {
    return 'View only — tap Control to request input authorization';
  }
  const gesture =
    pointerMode === 'touch'
      ? 'Tap to click · long-press to right-click · two fingers to scroll'
      : 'Drag to move the cursor · tap to click · two fingers to scroll';
  return lockLocal ? `${gesture} · local input locked` : gesture;
}

const makeStyles = (theme: Theme) => ({
  bar: {
    backgroundColor: theme.colors.coal,
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.xs,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    paddingHorizontal: theme.space.sm,
    gap: theme.space.xxs,
  },
  divider: {
    width: 1,
    alignSelf: 'stretch' as const,
    marginHorizontal: theme.space.sm,
    marginVertical: theme.space.sm,
    backgroundColor: theme.colors.hairline,
  },
  stop: {
    marginLeft: theme.space.xxs,
  },
  hint: {
    paddingHorizontal: theme.space.lg,
    paddingTop: theme.space.xs,
    paddingBottom: theme.space.xs,
    borderTopWidth: 1,
    borderTopColor: withAlpha(theme.colors.paper, 0.04),
  },
});
