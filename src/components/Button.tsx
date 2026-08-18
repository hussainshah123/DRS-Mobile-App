/**
 * Button. Three intents, one geometry.
 *
 *   primary   — coral fill. The single action a screen wants. Never two on one screen.
 *   secondary — hairline outline. Everything else.
 *   danger    — coral-tinted. Destructive or session-ending.
 *
 * The loading state swaps the label for a spinner while keeping the button's WIDTH, because a
 * button that shrinks when tapped moves everything below it — the most common jank in a
 * sign-in form.
 */
import React from 'react';
import { ActivityIndicator, StyleProp, Text, View, ViewStyle } from 'react-native';

import { type Theme, useThemedStyles, withAlpha } from '../theme';
import { type } from '../theme/typography';
import { Pressable } from './Pressable';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  intent?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  /** Renders full-width. */
  block?: boolean;
  /** Leading icon element, sized by the caller. */
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  intent = 'primary',
  disabled = false,
  loading = false,
  block = false,
  icon,
  style,
}: ButtonProps) {
  const styles = useThemedStyles(makeStyles);
  const isDisabled = disabled || loading;

  const containerStyles = [
    styles.base,
    intent === 'primary' && styles.primary,
    intent === 'secondary' && styles.secondary,
    intent === 'danger' && styles.danger,
    block && styles.block,
    isDisabled && styles.disabled,
    style,
  ];

  const labelStyles = [
    styles.label,
    intent === 'primary' && styles.labelPrimary,
    intent === 'secondary' && styles.labelSecondary,
    intent === 'danger' && styles.labelDanger,
  ];

  return (
    <Pressable
      style={containerStyles}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            size="small"
            color={intent === 'primary' ? styles.labelPrimary.color : styles.labelSecondary.color}
          />
        ) : (
          <>
            {icon ? <View style={styles.icon}>{icon}</View> : null}
            <Text style={labelStyles} numberOfLines={1}>
              {label}
            </Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const makeStyles = (theme: Theme) => ({
  base: {
    minHeight: 50,
    paddingHorizontal: theme.space.xl,
    borderRadius: theme.radius.pill,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  block: {
    alignSelf: 'stretch' as const,
  },
  primary: {
    backgroundColor: theme.colors.coral,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.hairline,
  },
  danger: {
    backgroundColor: withAlpha(theme.colors.coral, 0.12),
    borderColor: withAlpha(theme.colors.coral, 0.35),
  },
  disabled: {
    opacity: 0.4,
  },
  content: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: theme.space.sm,
  },
  icon: {
    marginRight: 0,
  },
  label: {
    ...type.button,
  },
  labelPrimary: {
    // Ink on coral, not white: coral is bright enough that white text vibrates against it.
    color: theme.colors.ink,
  },
  labelSecondary: {
    color: theme.colors.paper,
  },
  labelDanger: {
    color: theme.colors.coral,
  },
});
