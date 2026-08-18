/**
 * The entrance animation: fade up from 22px on the DRS curve.
 *
 * Ported from the dashboard's Reveal.jsx / `animate-fade-up`. `index` staggers a list so rows
 * arrive in sequence rather than all at once — the thing that makes a screen feel composed
 * instead of merely animated. The stagger is capped so the last row of a long list is not left
 * waiting; beyond ~8 items the eye has stopped tracking individual arrivals anyway.
 *
 * Both animated properties are native-driver, and the animation runs exactly once per mount.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, ViewStyle } from 'react-native';

import { fadeUp } from '../theme';

/** Per-item stagger. 45ms is fast enough to read as one motion, slow enough to be sequential. */
const STAGGER_MS = 45;
const MAX_STAGGER_MS = 360;

export type RevealProps = {
  children: React.ReactNode;
  /** Position in a list, for the stagger. */
  index?: number;
  /** Extra delay before the whole thing starts. */
  delay?: number;
  /** Travel distance; 0 makes it a pure fade. */
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

export function Reveal({ children, index = 0, delay = 0, distance, style }: RevealProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const stagger = Math.min(index * STAGGER_MS, MAX_STAGGER_MS);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: fadeUp.duration,
      delay: delay + stagger,
      easing: fadeUp.easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, index, progress]);

  const travel = distance ?? fadeUp.distance;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [travel, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
