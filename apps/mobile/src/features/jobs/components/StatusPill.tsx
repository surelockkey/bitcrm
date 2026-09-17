import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { statusLabel, statusTone, type StatusTone } from '../lib';
import type { JobSuperStatus } from '../types';

/**
 * A job's status.
 *
 * Three cues, never one: the word, the colour, and the shape of the marker
 * (filled square for work in hand, ring for waiting, bar for cancelled). A
 * technician who is colour-blind, or looking at a washed-out screen in the sun,
 * still reads it (docs/ARCHITECTURE.md §2.8).
 */
export function StatusPill({ status }: { status: JobSuperStatus | string }) {
  const { colors, radius, spacing, type } = useTheme();
  const tone = statusTone(status);

  const inks: Record<StatusTone, string> = {
    neutral: colors.textMuted,
    active: colors.primary,
    done: colors.success,
    warning: colors.warning,
    canceled: colors.danger,
  };
  const grounds: Record<StatusTone, string> = {
    neutral: colors.surfaceSunken,
    active: colors.primarySoft,
    done: colors.successSoft,
    warning: colors.warningSoft,
    canceled: colors.dangerSoft,
  };

  const ink = inks[tone];

  return (
    <View
      accessibilityLabel={`Status: ${statusLabel(status)}`}
      style={[
        styles.pill,
        {
          backgroundColor: grounds[tone],
          borderColor: ink,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.xs + 2,
          gap: spacing.sm,
        },
      ]}
    >
      <Marker tone={tone} color={ink} />
      <Text style={[type.caption, { color: ink }]}>{statusLabel(status)}</Text>
    </View>
  );
}

/** The shape half of the cue. */
function Marker({ tone, color }: { tone: StatusTone; color: string }) {
  if (tone === 'canceled') {
    return <View style={[styles.bar, { backgroundColor: color }]} />;
  }
  if (tone === 'warning' || tone === 'neutral') {
    return <View style={[styles.ring, { borderColor: color }]} />;
  }
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  dot: { width: 10, height: 10, borderRadius: 2 },
  ring: { width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  bar: { width: 10, height: 3, borderRadius: 2 },
});
