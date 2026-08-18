/**
 * The live/offline indicator.
 *
 * When `pulse` is set the dot breathes — the app's only ambient animation, and the one signal
 * that says "this data is live, not a snapshot". It matches the dashboard's `animate-pulse-soft`
 * (1.3s, opacity 1 → 0.25 → 1) exactly, because the two surfaces are read side by side.
 *
 * The loop runs on the native driver and is stopped on unmount. That detail matters here more
 * than anywhere else in the app: this component appears once per row in the device list, so a
 * leaked loop is a leak per device.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { duration, easing, useTheme, withAlpha } from '../theme';

export type StatusDotProps = {
  color: string;
  size?: number;
  /** Breathe, for a live state. */
  pulse?: boolean;
  /** Draw a soft halo behind the dot — used for the session's LIVE badge. */
  halo?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function StatusDot({ color, size = 8, pulse = false, halo = false, style }: StatusDotProps) {
  const theme = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) {
      // Snap back to fully opaque: a dot left mid-fade reads as a rendering bug.
      opacity.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: duration.ambient / 2,
          easing: easing.inOut,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: duration.ambient / 2,
          easing: easing.inOut,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, pulse]);

  return (
    <View style={[{ width: size, height: size }, style]}>
      {halo ? (
        <View
          style={{
            ...dotStyles.halo,
            left: -size * 0.75,
            top: -size * 0.75,
            width: size * 2.5,
            height: size * 2.5,
            borderRadius: size * 1.25,
            backgroundColor: withAlpha(color, theme.isDark ? 0.18 : 0.14),
          }}
        />
      ) : null}
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity,
        }}
      />
    </View>
  );
}

const dotStyles = StyleSheet.create({
  halo: {
    position: 'absolute',
  },
});
