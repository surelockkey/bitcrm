import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import {
  WEEKDAY_LABELS,
  monthLabel,
  monthMatrix,
  monthOf,
  shiftMonthIso,
  visitCountLabel,
  type DayMark,
} from '../calendar';

export interface MonthGridProps {
  /** The day the calendar opens on, and the one drawn as chosen. */
  selectedIso: string;
  todayIso: string;
  /** Visits and "still open" dots per day. Empty is fine — the grid still works. */
  marks?: Map<string, DayMark>;
  /** Days before this one are not offered. Absent, every day is. */
  minDateIso?: string;
  onSelect: (dateIso: string) => void;
}

/**
 * The small calendar Workiz opens over the schedule (§1.3).
 *
 * A month at a time, with the months paged by two large buttons rather than a
 * swipe — a mis-swipe here costs a technician the day they were looking at, and
 * this is used standing up. Under each date with work on it sits a dot, and the
 * dot turns to the warning colour for a past day that still has an open job:
 * Workiz's own indicator, and the only reason anybody scrolls backwards.
 *
 * Every cell clears the 56 dp touch floor and carries its count in the
 * accessibility label, because the dot itself is unreadable to a screen reader
 * and colour is never the only carrier (docs/ARCHITECTURE.md §2.9).
 *
 * The grid is separate from the sheet below so the reschedule sheet can draw
 * it inline: nesting one `Modal` inside another is unreliable on iOS, and two
 * calendars that drift apart is exactly the kind of thing that teaches a
 * technician to distrust one of them.
 */
export function MonthGrid({
  selectedIso,
  todayIso,
  marks,
  minDateIso,
  onSelect,
}: MonthGridProps) {
  const { colors, spacing, type } = useTheme();
  const [month, setMonth] = useState(() => monthOf(selectedIso));
  // The month follows the day the technician is on. Without this, paging to
  // December, closing the sheet and reopening it a week later would still open
  // on December — the sheet has to start where the list already is. Derived
  // during the render that notices the change rather than in an effect, so the
  // grid is never painted on the wrong month for a frame.
  const [anchor, setAnchor] = useState(selectedIso);
  if (anchor !== selectedIso) {
    setAnchor(selectedIso);
    setMonth(monthOf(selectedIso));
  }
  const rows = monthMatrix(month);

  return (
    <View testID="month-grid" style={{ gap: spacing.md }}>
      <View style={[styles.monthRow, { gap: spacing.md }]}>
        <Button
          label="‹"
          testID="month-prev"
          variant="secondary"
          accessibilityHint="Previous month"
          style={styles.arrow}
          onPress={() => setMonth(shiftMonthIso(month, -1))}
        />
        <Text
          accessibilityRole="header"
          testID="month-label"
          style={[type.heading, styles.monthLabel, { color: colors.text }]}
        >
          {monthLabel(month)}
        </Text>
        <Button
          label="›"
          testID="month-next"
          variant="secondary"
          accessibilityHint="Next month"
          style={styles.arrow}
          onPress={() => setMonth(shiftMonthIso(month, 1))}
        />
      </View>

      <View style={styles.week}>
        {WEEKDAY_LABELS.map((label) => (
          <Text
            key={label}
            style={[type.caption, styles.cellText, { color: colors.textMuted }]}
          >
            {label}
          </Text>
        ))}
      </View>

      {rows.map((row, index) => (
        <View key={`${month}-row-${index}`} style={styles.week}>
          {row.map((dateIso, column) => (
            <Cell
              key={dateIso ?? `pad-${column}`}
              dateIso={dateIso}
              selected={dateIso === selectedIso}
              today={dateIso === todayIso}
              mark={dateIso ? marks?.get(dateIso) : undefined}
              disabled={Boolean(dateIso && minDateIso && dateIso < minDateIso)}
              onSelect={onSelect}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

export interface DayPickerProps extends MonthGridProps {
  visible: boolean;
  onCancel: () => void;
  title?: string;
}

/** The grid as a sheet over the day list. */
export function DayPicker({
  visible,
  onCancel,
  title = 'Pick a day',
  ...grid
}: DayPickerProps) {
  const { colors, radius, spacing, touch, type } = useTheme();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View
          testID="day-picker"
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
          }}
        >
          <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
            {title}
          </Text>

          <MonthGrid {...grid} />

          <View style={{ height: spacing.sm }} />
          <Button
            label="Cancel"
            variant="ghost"
            testID="day-picker-cancel"
            onPress={onCancel}
            style={{ minHeight: touch.min }}
          />
        </View>
      </View>
    </Modal>
  );
}

function Cell({
  dateIso,
  selected,
  today,
  mark,
  disabled,
  onSelect,
}: {
  dateIso: string | null;
  selected: boolean;
  today: boolean;
  mark: DayMark | undefined;
  disabled: boolean;
  onSelect: (dateIso: string) => void;
}) {
  const { colors, radius, spacing, touch, type } = useTheme();

  if (!dateIso) return <View style={styles.cell} />;

  const day = Number(dateIso.slice(8, 10));
  // The chosen day is filled; today is outlined. Two different shapes, so the
  // pair is still distinguishable in monochrome and in bright sun.
  const background = selected ? colors.primary : 'transparent';
  const ink = selected ? colors.onAccent : disabled ? colors.textMuted : colors.text;
  const visits = mark?.visits ?? 0;

  return (
    <Pressable
      testID={`day-${dateIso}`}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`${dateIso}, ${visitCountLabel(visits)}${
        mark?.hasOpenPast ? ', still open' : ''
      }`}
      disabled={disabled}
      onPress={() => onSelect(dateIso)}
      style={({ pressed }) => [
        styles.cell,
        {
          minHeight: touch.min,
          paddingVertical: spacing.xs,
          borderRadius: radius.md,
          backgroundColor: background,
          borderWidth: today && !selected ? 2 : 0,
          borderColor: colors.primary,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Text style={[type.body, { color: ink }]}>{day}</Text>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: !visits
              ? 'transparent'
              : mark?.hasOpenPast
                ? colors.warning
                : selected
                  ? colors.onAccent
                  : colors.primary,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  monthRow: { flexDirection: 'row', alignItems: 'center' },
  monthLabel: { flex: 1, textAlign: 'center' },
  arrow: { minWidth: 72 },
  week: { flexDirection: 'row' },
  cell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cellText: { flex: 1, textAlign: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
});
