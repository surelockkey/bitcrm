import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import { dayNavCaption, dayNavTitle } from '../../jobs/calendar';

export interface DateRailProps {
  selectedIso: string;
  todayIso: string;
  visits: number;
  onPrev: () => void;
  onNext: () => void;
  /** The date itself opens the calendar. */
  onPick: () => void;
}

/**
 * The rail down the left of Workiz's Timeline: the weekday over a circled day
 * number, with the day's content beside it
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4).
 *
 * Theirs is a label. Ours is also the navigation, because the header above it
 * has no room for four more controls and a technician moving off today has to
 * be able to get back: the date is the button that opens the calendar, and the
 * two arrows stacked under it step a day at a time. The list beside it still
 * swipes sideways, which is how most days get changed; this is for the day
 * that gets changed with a glove on.
 */
export function DateRail({
  selectedIso,
  todayIso,
  visits,
  onPrev,
  onNext,
  onPick,
}: DateRailProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const weekday = new Date(`${selectedIso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
  });
  const dayNumber = String(Number(selectedIso.slice(8, 10)));
  const isToday = selectedIso === todayIso;

  return (
    <View
      testID="date-rail"
      style={[styles.rail, { paddingVertical: spacing.sm, gap: spacing.sm }]}
    >
      <Button
        label="‹"
        testID="rail-prev"
        variant="ghost"
        accessibilityHint="The day before"
        style={styles.arrow}
        onPress={onPrev}
      />

      <Pressable
        testID="rail-date"
        accessibilityRole="button"
        accessibilityLabel={`${dayNavTitle(selectedIso)}, ${dayNavCaption(
          selectedIso,
          todayIso,
          visits,
        )}`}
        accessibilityHint="Opens the calendar"
        onPress={onPick}
        style={({ pressed }) => [styles.date, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>{weekday}</Text>
        <View
          style={[
            styles.circle,
            {
              minWidth: touch.min - 8,
              minHeight: touch.min - 8,
              borderRadius: radius.pill,
              backgroundColor: isToday ? colors.primary : 'transparent',
              borderColor: colors.primary,
              borderWidth: isToday ? 0 : 2,
            },
          ]}
        >
          <Text
            style={[type.heading, { color: isToday ? colors.onAccent : colors.text }]}
          >
            {dayNumber}
          </Text>
        </View>
      </Pressable>

      <Button
        label="›"
        testID="rail-next"
        variant="ghost"
        accessibilityHint="The day after"
        style={styles.arrow}
        onPress={onNext}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: 72, alignItems: 'center' },
  arrow: { minWidth: 56, paddingHorizontal: 0 },
  date: { alignItems: 'center', gap: 2 },
  circle: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
