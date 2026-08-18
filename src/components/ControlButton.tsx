/**
 * A toolbar control: icon over a mono label, in a fixed-width column.
 *
 * Fixed width matters more than it sounds. The toolbar's items change label as they toggle
 * ("View" ⇄ "Control", "Keys" ⇄ "Hide"), and if each item sized to its own text the whole row
 * would shuffle on every toggle — so a control the operator is about to tap moves out from under
 * their finger. A fixed column keeps every target where it was.
 *
 * The active state is carried by colour AND a filled well, never colour alone, so the toolbar is
 * readable for a colour-blind operator and in sunlight.
 */
import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

import { type Theme, useTheme, useThemedStyles, withAlpha } from '../theme';
import { Eyebrow } from './Eyebrow';
import type { IconProps } from './Icons';
import { Pressable } from './Pressable';
import type { Cue } from '../utils/sound';

export type ControlButtonProps = {
  label: string;
  icon: React.ComponentType<IconProps>;
  onPress: () => void;
  /** Latched on — coral fill. */
  active?: boolean;
  disabled?: boolean;
  /** Tint for the active state; defaults to coral. */
  activeColor?: string;
  cue?: Cue | null;
  style?: StyleProp<ViewStyle>;
};

/** Column width — sized for the longest label in the toolbar ("Keyboard") at 9pt mono. */
const COLUMN_WIDTH = 62;

export function ControlButton({
  label,
  icon: Icon,
  onPress,
  active = false,
  disabled = false,
  activeColor,
  cue = 'tap',
  style,
}: ControlButtonProps) {
  const theme = useTheme();
  const styles = useThemedStyles(makeStyles);
  const accent = activeColor ?? theme.colors.coral;

  const tint = disabled ? theme.colors.faint : active ? accent : theme.colors.muted;

  return (
    <Pressable
      style={[styles.button, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      cue={cue}
      scaleTo={0.93}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active, disabled }}
    >
      <View
        style={[
          styles.well,
          active && {
            backgroundColor: withAlpha(accent, 0.14),
            borderColor: withAlpha(accent, 0.4),
          },
        ]}
      >
        <Icon size={19} color={tint} />
      </View>
      <Eyebrow size={9} color={tint} tracking={0.14} numberOfLines={1}>
        {label}
      </Eyebrow>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => ({
  button: {
    width: COLUMN_WIDTH,
    alignItems: 'center' as const,
    gap: 5,
    paddingVertical: theme.space.xs,
  },
  disabled: {
    opacity: 0.45,
  },
  well: {
    width: 38,
    height: 38,
    borderRadius: theme.radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: theme.colors.hairline,
    backgroundColor: theme.colors.sand,
  },
});
