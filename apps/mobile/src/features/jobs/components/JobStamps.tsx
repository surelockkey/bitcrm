import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { jobStamps } from '../lib';
import type { Deal } from '../types';

/**
 * Sent → Seen → Arrived, the same trail dispatch watches from the other end.
 * On the card rather than in the timeline, so "did you get the 2 o'clock?"
 * can be answered without opening anything.
 */
export function JobStamps({ deal }: { deal: Deal }) {
  const { colors, spacing, type } = useTheme();
  const stamps = jobStamps(deal);
  const label = stamps
    .map((s) => `${s.label}${s.done ? ` at ${s.time ?? 'an unknown time'}` : ': not yet'}`)
    .join('. ');

  return (
    <View
      accessibilityLabel={label}
      style={[styles.row, { gap: spacing.lg }]}
    >
      {stamps.map((stamp) => (
        <View key={stamp.key} style={styles.item}>
          <View style={styles.headline}>
            <View
              style={[
                stamp.done ? styles.tick : styles.pending,
                {
                  backgroundColor: stamp.done ? colors.success : 'transparent',
                  borderColor: stamp.done ? colors.success : colors.border,
                },
              ]}
            />
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {stamp.label}
            </Text>
          </View>
          <Text
            style={[
              type.caption,
              { color: stamp.done ? colors.text : colors.textMuted },
            ]}
          >
            {stamp.done ? (stamp.time ?? '—') : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  item: { gap: 2 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tick: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  pending: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
});
