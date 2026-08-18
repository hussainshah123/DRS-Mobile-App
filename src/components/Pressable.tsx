/**
 * The app's press primitive.
 *
 * Every tappable surface goes through this so two things are true everywhere without being
 * re-implemented: the press animation is identical, and the sound cue fires exactly once.
 *
 * The animation is a scale-down plus a slight opacity drop, both on the native driver, driven
 * by a spring stiff enough not to bounce. It is deliberately NOT the platform default —
 * Android's ripple and iOS's opacity fade feel like two different apps, and on a dark operator
 * UI a ripple reads as a smudge.
 *
 * The sound is where haptics would normally go. It fires on press-IN, not on press-out: the
 * feedback has to coincide with the finger landing, or it feels like lag rather than
 * confirmation.
 */
import React, { useCallback, useRef } from 'react';
import {
  Animated,
  Pressable as RNPressable,
  StyleProp,
  ViewStyle,
  type PressableProps as RNPressableProps,
} from 'react-native';

import { pressSpring } from '../theme';
import { play, type Cue } from '../utils/sound';

export type PressableProps = Omit<RNPressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
  /** How far to scale down on press. Smaller controls need less to read as pressed. */
  scaleTo?: number;
  /** Opacity at full press. */
  dimTo?: number;
  /** Which cue to play, or null for silence (used by rapidly-repeating keys). */
  cue?: Cue | null;
  /** Set false to skip the animation entirely (long lists where scale would fight the scroll). */
  animate?: boolean;
};

export function Pressable({
  style,
  children,
  scaleTo = 0.97,
  dimTo = 0.85,
  cue = 'tap',
  animate = true,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: PressableProps) {
  // A single 0→1 value drives both transforms, so they can never desynchronise.
  const progress = useRef(new Animated.Value(0)).current;

  const animateTo = useCallback(
    (value: number) => {
      if (!animate) {
        return;
      }
      Animated.spring(progress, { toValue: value, ...pressSpring }).start();
    },
    [animate, progress],
  );

  const handlePressIn = useCallback<NonNullable<RNPressableProps['onPressIn']>>(
    event => {
      animateTo(1);
      if (cue && !disabled) {
        play(cue);
      }
      onPressIn?.(event);
    },
    [animateTo, cue, disabled, onPressIn],
  );

  const handlePressOut = useCallback<NonNullable<RNPressableProps['onPressOut']>>(
    event => {
      animateTo(0);
      onPressOut?.(event);
    },
    [animateTo, onPressOut],
  );

  const animatedStyle = {
    transform: [
      {
        scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, scaleTo] }),
      },
    ],
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, dimTo] }),
  };

  return (
    <RNPressable
      {...rest}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      // Nudge the touch target outward. 44pt is the accessibility minimum and many of these
      // controls are visually smaller than that by design.
      hitSlop={rest.hitSlop ?? 8}
    >
      <Animated.View style={[style, animate ? animatedStyle : null]}>{children}</Animated.View>
    </RNPressable>
  );
}
