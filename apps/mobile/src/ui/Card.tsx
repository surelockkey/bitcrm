import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';

export interface CardProps {
  children: React.ReactNode;
  /** Makes the whole card the target — used by the job list rows. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** A raised surface. Tappable when given `onPress`, inert otherwise. */
export function Card({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: CardProps) {
  const { colors, radius, spacing } = useTheme();
  const base: StyleProp<ViewStyle> = [
    styles.card,
    {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    style,
  ];

  if (!onPress) {
    return (
      <View testID={testID} style={base}>
        {children}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [base, pressed && styles.pressed]}
    >
      {children}
    </Pressable>
  );
}

/** A `label: value` line inside a card. Wraps rather than truncating. */
export function CardRow({ label, value }: { label: string; value: string }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={[styles.row, { gap: spacing.lg }]}>
      <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[type.label, styles.value, { color: colors.text }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: 0.85 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  value: { flexShrink: 1, textAlign: 'right' },
});
