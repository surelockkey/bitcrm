import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/theme/theme-provider';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** What choosing it does, for a screen reader. */
  hint?: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Names the group itself — "Schedule view". */
  accessibilityLabel: string;
  testID?: string;
}

/**
 * Two or three ways of looking at the same thing, side by side.
 *
 * Workiz's Schedule has `Timeline / Day` and its Timesheets `Day / Week /
 * Month` (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4, §6), and both are this
 * shape. The selected one is filled *and* announced as selected: colour alone
 * is never the carrier, and a `tab` role tells a screen reader that moving
 * between these swaps the content below rather than opening a new screen.
 *
 * Each segment is a full touch target and the labels wrap rather than truncate,
 * so "Timeline" still reads at `fontScale` 1.3.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  testID,
}: SegmentedControlProps<T>) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.bar,
        {
          backgroundColor: colors.surfaceSunken,
          borderRadius: radius.md,
          padding: spacing.xs,
          gap: spacing.xs,
        },
      ]}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={testID ? `${testID}-${option.value}` : undefined}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityHint={option.hint}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.segment,
              {
                minHeight: touch.min - 8,
                borderRadius: radius.sm,
                paddingHorizontal: spacing.md,
                backgroundColor: selected ? colors.primary : 'transparent',
                opacity: pressed && !selected ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                type.label,
                styles.label,
                { color: selected ? colors.onAccent : colors.text },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row' },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center' },
});
