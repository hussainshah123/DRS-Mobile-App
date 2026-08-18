/**
 * CPU / RAM load bar.
 *
 * The colour steps with intensity — lime below 60, amber to 85, coral above — matching the
 * dashboard's load bar, so a machine that looks stressed in the browser looks stressed here.
 *
 * The fill animates on `scaleX` rather than `width`, because width is a layout property and
 * cannot run on the native driver: with a 5-second poll across a fleet of devices, animating
 * layout would mean a JS-thread animation per row on every refresh.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { duration, easing, useTheme, withAlpha } from '../theme';

export type MeterProps = {
  /** 0–100. */
  value: number;
  /** Track height. */
  height?: number;
  /** Dim the whole meter — used for an offline device, whose metrics are zeroed anyway. */
  inactive?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Meter({ value, height = 4, inactive = false, style }: MeterProps) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, value));
  // scaleX from a full-width bar. Zero would collapse the layer entirely, so an empty meter
  // holds a hairline of fill — which also reads correctly as "measured, and it's zero".
  const scale = useRef(new Animated.Value(Math.max(clamped / 100, 0.001))).current;

  useEffect(() => {
    const animation = Animated.timing(scale, {
      toValue: Math.max(clamped / 100, 0.001),
      duration: duration.base,
      easing: easing.standard,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [clamped, scale]);

  const fill =
    clamped >= 85 ? theme.colors.coral : clamped >= 60 ? theme.colors.amber : theme.colors.lime;

  return (
    <View
      style={[
        meterStyles.track,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: withAlpha(theme.colors.paper, theme.isDark ? 0.08 : 0.1),
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          meterStyles.fill,
          inactive && meterStyles.fillInactive,
          {
            height,
            borderRadius: height / 2,
            backgroundColor: inactive ? theme.colors.muted : fill,
            transform: [{ scaleX: scale }],
          },
        ]}
      />
    </View>
  );
}

const meterStyles = StyleSheet.create({
  track: {
    overflow: 'hidden',
  },
  fill: {
    width: '100%',
    alignSelf: 'flex-start',
    // scaleX scales about the centre by default; the left origin makes the bar grow from the start
    // of the track like a real progress fill (RN 0.76+ honours transformOrigin).
    transformOrigin: 'left center',
  },
  /** An offline device's metrics are zeroed by the backend; dim the bar so it reads as absent
      rather than idle. */
  fillInactive: {
    opacity: 0.35,
  },
});
