import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'regular' | 'hero';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  /** Shows a spinner and blocks further taps — a double-tap sends one action. */
  busy?: boolean;
  /** Secondary line under the label ("Tells the client you're on the way"). */
  hint?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * The only button in the app.
 *
 * Height comes from the touch tokens, never from padding, so a gloved thumb
 * always has at least 56 dp to land on and a screen's main action gets 64
 * (docs/ARCHITECTURE.md §2.9). Text never truncates: the label wraps and the
 * button grows, because a technician at `fontScale` 1.3 still has to read it.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  disabled = false,
  busy = false,
  hint,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const inert = disabled || busy;

  const fills: Record<ButtonVariant, string> = {
    primary: colors.primary,
    secondary: colors.surface,
    danger: colors.danger,
    ghost: 'transparent',
  };
  const inks: Record<ButtonVariant, string> = {
    primary: colors.onAccent,
    secondary: colors.text,
    danger: colors.onAccent,
    ghost: colors.primary,
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint ?? hint}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: size === 'hero' ? touch.primary : touch.min,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          backgroundColor: fills[variant],
          borderWidth: variant === 'secondary' || variant === 'ghost' ? 2 : 0,
          borderColor: variant === 'ghost' ? colors.primary : colors.border,
          opacity: inert ? 0.55 : pressed ? 0.82 : 1,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={inks[variant]} /> : null}
      <View style={styles.labels}>
        <Text style={[type.body, styles.label, { color: inks[variant] }]}>
          {label}
        </Text>
        {hint ? (
          <Text style={[type.caption, { color: inks[variant], opacity: 0.85 }]}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  labels: { alignItems: 'center', flexShrink: 1 },
  label: { textAlign: 'center' },
});
