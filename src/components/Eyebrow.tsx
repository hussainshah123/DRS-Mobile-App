/**
 * The uppercase mono micro-label — the Fort Dice signature element. Section kickers, metadata
 * captions, status text, key names.
 *
 * It exists as a component rather than a style constant because the tracking has to scale with
 * the size (letterSpacing is absolute points in React Native, not em), and getting that wrong
 * is the difference between a crisp label and a smear.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

import { eyebrow, fonts, useTheme } from '../theme';

export type EyebrowProps = {
  children: React.ReactNode;
  size?: number;
  /** Defaults to the muted secondary tone. */
  color?: string;
  /** Tracking as a fraction of the font size. */
  tracking?: number;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

export function Eyebrow({
  children,
  size = 10,
  color,
  tracking = 0.18,
  style,
  numberOfLines,
}: EyebrowProps) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[eyebrow(size, tracking), { color: color ?? theme.colors.muted }, style]}
    >
      {children}
    </Text>
  );
}

/** Readout — mono but not uppercase: ids, IPs, resolutions, timers. */
export function Readout({
  children,
  size = 12,
  color,
  bold = false,
  style,
  numberOfLines,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  bold?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
}) {
  const theme = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        bold ? readoutStyles.bold : readoutStyles.regular,
        { fontSize: size, color: color ?? theme.colors.paper },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

/**
 * The two mono faces as static entries. Space Mono ships only 400 and 700, so the weight is
 * selected by FAMILY rather than by fontWeight — asking for 700 on the regular face gets a
 * synthesised bold on Android, which is visibly smeared at label sizes.
 */
const readoutStyles = StyleSheet.create({
  regular: { fontFamily: fonts.mono },
  bold: { fontFamily: fonts.monoBold },
});
