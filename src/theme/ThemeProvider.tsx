/**
 * Theme context. The palette flips with the OS appearance by default (matching the
 * dashboard, which follows `prefers-color-scheme` until the user picks a mode) and
 * can be overridden per-session from Settings.
 *
 * Consumers get the resolved palette plus the shared spacing/radius scales through
 * `useTheme()`, and build their StyleSheet with `useThemedStyles(factory)` so the
 * sheet is created once per theme rather than on every render.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  StyleSheet,
  useColorScheme,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Palette, palettes, ThemeName } from './palette';

/**
 * 4pt spacing grid. Named rather than numeric so a layout reads as intent
 * ("gap: space.md") and the whole app can be tightened from one place.
 */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Radii. `card` (20) and `panel` (28) match the dashboard's rounded-[20px] cards and
 * rounded-[28px] session panel; `pill` is deliberately huge so it stays a capsule at
 * any height without per-component maths.
 */
export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  card: 20,
  panel: 28,
  pill: 999,
} as const;

export type Theme = {
  name: ThemeName;
  colors: Palette;
  space: typeof space;
  radius: typeof radius;
  /** true when the palette is the dark one — for status bar style, blur tint, etc. */
  isDark: boolean;
};

type ThemeContextValue = Theme & {
  /** null = follow the OS appearance. */
  override: ThemeName | null;
  setOverride: (name: ThemeName | null) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [override, setOverride] = useState<ThemeName | null>(null);

  const value = useMemo<ThemeContextValue>(() => {
    // Dark is the DRS default, so an unknown/null system scheme resolves to dark
    // rather than light — an operator tool should not flash white.
    const name: ThemeName = override ?? (system === 'light' ? 'light' : 'dark');
    return {
      name,
      colors: palettes[name],
      space,
      radius,
      isDark: name === 'dark',
      override,
      setOverride,
    };
  }, [override, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/**
 * A single entry in a style sheet. Declared here because RN 0.87's generated types no longer export
 * `StyleSheet.NamedStyles`, which this constraint used to reference.
 */
type StyleValue = ViewStyle | TextStyle | ImageStyle;

/**
 * useThemedStyles memoizes a StyleSheet per theme. `factory` must be a stable
 * module-level function (not an inline arrow), otherwise the sheet is rebuilt on
 * every render and the memo buys nothing.
 */
export function useThemedStyles<T extends Record<string, StyleValue>>(
  factory: (theme: Theme) => T,
): T {
  const theme = useTheme();
  const cb = useCallback(factory, [factory]);
  return useMemo(() => StyleSheet.create(cb(theme)), [cb, theme]);
}
