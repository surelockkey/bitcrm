import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';

export interface QueueBadgeProps {
  waiting: number;
  failed: number;
  /** Narrows the counts to one job, for the job screen. */
  label?: string;
  onPress?: () => void;
}

/**
 * "Nothing has been lost."
 *
 * A queue with no visible state is indistinguishable from data quietly
 * disappearing, so every waiting or parked row is counted somewhere the
 * technician can see it (docs/ARCHITECTURE.md §2.5). Parked rows outrank
 * waiting ones — those are the ones that need a person.
 */
export function QueueSummary({ waiting, failed, label }: QueueBadgeProps) {
  const { colors, radius, spacing, type } = useTheme();
  if (!waiting && !failed) return null;

  const bad = failed > 0;
  const text = bad
    ? `${failed} ${failed === 1 ? 'item' : 'items'} not sent`
    : `${waiting} waiting to send`;

  return (
    <View
      testID="queue-summary"
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${text}${label ? ` for ${label}` : ''}`}
      style={[
        styles.wrap,
        {
          backgroundColor: bad ? colors.dangerSoft : colors.primarySoft,
          borderColor: bad ? colors.danger : colors.primary,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        },
      ]}
    >
      <View
        style={[
          bad ? styles.bar : styles.dot,
          { backgroundColor: bad ? colors.danger : colors.primary },
        ]}
      />
      <Text style={[type.caption, { color: bad ? colors.danger : colors.primary }]}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  bar: { width: 10, height: 3, borderRadius: 2 },
});
