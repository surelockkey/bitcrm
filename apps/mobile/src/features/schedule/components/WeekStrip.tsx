import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { jobCountLabel, type WeekDay } from '../lib';

export interface WeekStripProps {
  days: readonly WeekDay[];
  onSelect: (iso: string) => void;
}

/**
 * `Sun 13 … Sat 19` over the hour grid — Workiz's week strip
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4).
 *
 * Seven full touch targets across a phone is tight, so the row is what decides
 * the minimum: nothing here is smaller than 44 dp wide and each cell is at
 * least the touch floor tall. The selected day is filled and today is ringed —
 * two different signals, because on Tuesday looking at Friday both have to be
 * legible at once.
 *
 * The dot under a day means work on it. It is never the only carrier: the
 * count is in the accessibility label, spoken as "3 jobs".
 */
export function WeekStrip({ days, onSelect }: WeekStripProps) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <View
      testID="week-strip"
      accessibilityRole="tablist"
      accessibilityLabel="Week"
      style={[styles.row, { paddingHorizontal: spacing.sm, gap: 2 }]}
    >
      {days.map((day) => (
        <Pressable
          key={day.iso}
          testID={`week-day-${day.iso}`}
          accessibilityRole="tab"
          accessibilityState={{ selected: day.isSelected }}
          accessibilityLabel={`${day.weekday} ${day.day}${
            day.isToday ? ', today' : ''
          }, ${jobCountLabel(day.visits)}`}
          onPress={() => onSelect(day.iso)}
          style={({ pressed }) => [
            styles.cell,
            {
              minHeight: touch.min,
              borderRadius: radius.md,
              paddingVertical: spacing.xs,
              backgroundColor: day.isSelected ? colors.primary : 'transparent',
              borderWidth: day.isToday && !day.isSelected ? 2 : 0,
              borderColor: colors.primary,
              opacity: pressed && !day.isSelected ? 0.7 : 1,
            },
          ]}
        >
          <Text
            style={[
              type.caption,
              { color: day.isSelected ? colors.onAccent : colors.textMuted },
            ]}
          >
            {day.weekday}
          </Text>
          <Text
            style={[
              type.heading,
              { color: day.isSelected ? colors.onAccent : colors.text },
            ]}
          >
            {day.day}
          </Text>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: day.visits
                  ? day.isSelected
                    ? colors.onAccent
                    : colors.primary
                  : 'transparent',
              },
            ]}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center', minWidth: 40 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
});
