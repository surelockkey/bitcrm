import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { dayNavCaption, dayNavTitle } from '../calendar';

export interface DayBarProps {
  selectedIso: string;
  todayIso: string;
  visits: number;
  onPrev: () => void;
  onNext: () => void;
  /** Opens the calendar. */
  onPick: () => void;
  /** Back to today. Drawn only when the technician has moved off it. */
  onToday: () => void;
}

/**
 * Which day the list is showing, and the two ways off it.
 *
 * Workiz's schedule leads with the date and the number of visits on it (§1.3),
 * and so does this: the day is what a technician checks first, and the count
 * answers "is that all of them?" without scrolling. The arrows are full touch
 * targets rather than chevrons in a header — this is tapped with a glove on.
 *
 * The date itself is the button that opens the calendar, which is where a
 * technician's thumb goes anyway.
 */
export function DayBar({
  selectedIso,
  todayIso,
  visits,
  onPrev,
  onNext,
  onPick,
  onToday,
}: DayBarProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const title = dayNavTitle(selectedIso);
  const count = dayNavCaption(selectedIso, todayIso, visits);

  return (
    <View
      testID="day-bar"
      style={[
        styles.bar,
        {
          paddingHorizontal: spacing.lg,
          paddingBottom: spacing.sm,
          gap: spacing.md,
        },
      ]}
    >
      <Button
        label="‹"
        testID="day-prev"
        variant="secondary"
        accessibilityHint="The day before"
        style={styles.arrow}
        onPress={onPrev}
      />

      <Pressable
        testID="day-open-calendar"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${count}`}
        accessibilityHint="Opens the calendar"
        onPress={onPick}
        style={({ pressed }) => [
          styles.middle,
          {
            minHeight: touch.min,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            paddingHorizontal: spacing.md,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
      >
        <Text style={[type.heading, styles.center, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[type.caption, styles.center, { color: colors.textMuted }]}>
          {count}
        </Text>
      </Pressable>

      <Button
        label="›"
        testID="day-next"
        variant="secondary"
        accessibilityHint="The day after"
        style={styles.arrow}
        onPress={onNext}
      />

      {selectedIso !== todayIso ? (
        <Button
          label="Today"
          testID="day-today"
          variant="ghost"
          accessibilityHint="Back to today's list"
          style={styles.today}
          onPress={onToday}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  arrow: { minWidth: 64 },
  middle: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center' },
  today: { flexBasis: '100%' },
});
