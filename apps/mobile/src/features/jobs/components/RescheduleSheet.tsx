import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../lib/theme/theme-provider';
import { Button } from '../../../ui/Button';
import type { RescheduleDealBody } from '../api';
import { formatDayHeading, formatSlot } from '../lib';
import {
  buildReschedule,
  describeMove,
  minutesOfDay,
  refuseReason,
  slotOptions,
} from '../reschedule';
import { MonthGrid } from './DayPicker';

export interface RescheduleSheetProps {
  visible: boolean;
  dealNumber: string;
  /** Where the visit is booked now. Absent for a job nobody has dated. */
  scheduledDate?: string;
  scheduledTimeSlot?: string;
  allDay?: boolean;
  todayIso: string;
  onConfirm: (next: RescheduleDealBody) => void;
  onCancel: () => void;
}

/**
 * Moving the visit: a day, then a window, then one button that says where the
 * job is going (§1.3).
 *
 * Two steps in the order Workiz asks them, and the confirm button spells the
 * destination out rather than saying "Save" — this is tapped at a doorstep, and
 * the sentence on the button is the last chance to notice it says Tuesday.
 *
 * A day already gone cannot be chosen: past dates are drawn dead in the grid,
 * and on today a window that has already ended is not offered at all. A job
 * moved backwards drops out of the day list into "still open from earlier",
 * where it reads as work somebody forgot about — so the way to make that
 * mistake is simply not built.
 */
export function RescheduleSheet({
  visible,
  dealNumber,
  scheduledDate,
  scheduledTimeSlot,
  allDay,
  todayIso,
  onConfirm,
  onCancel,
}: RescheduleSheetProps) {
  const { colors, radius, spacing, type } = useTheme();
  // A job with no date, or one dispatch left in the past, starts on today:
  // the sheet may only ever offer a day it would also accept.
  const opensOn =
    scheduledDate && scheduledDate.slice(0, 10) > todayIso
      ? scheduledDate.slice(0, 10)
      : todayIso;

  const [date, setDate] = useState(opensOn);
  const [slot, setSlot] = useState<string | undefined>(scheduledTimeSlot);
  const [wholeDay, setWholeDay] = useState(Boolean(allDay));
  // Reopening the sheet has to forget what the last visit to it chose.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (visible) {
      setDate(opensOn);
      setSlot(scheduledTimeSlot);
      setWholeDay(Boolean(allDay));
    }
  }

  const options = slotOptions(date, todayIso, minutesOfDay(), scheduledTimeSlot);
  const offered = options.filter((o) => !o.past);
  const hidden = options.length - offered.length;
  const next = buildReschedule(date, slot, wholeDay);
  const refused = refuseReason(next, todayIso, minutesOfDay());

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View
          testID="reschedule-sheet"
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: spacing.lg,
            gap: spacing.md,
            maxHeight: '92%',
          }}
        >
          <Text accessibilityRole="header" style={[type.title, { color: colors.text }]}>
            Reschedule job {dealNumber}
          </Text>
          <Text style={[type.body, { color: colors.textMuted }]}>
            {scheduledDate
              ? `Booked for ${formatDayHeading(scheduledDate.slice(0, 10))}, ${formatSlot(
                  scheduledTimeSlot,
                  allDay,
                )}. The client is not told — tell them yourself, or ask the office to.`
              : 'This job has no date yet. The client is not told — tell them yourself, or ask the office to.'}
          </Text>

          <ScrollView contentContainerStyle={{ gap: spacing.md }}>
            <MonthGrid
              selectedIso={date}
              todayIso={todayIso}
              minDateIso={todayIso}
              onSelect={setDate}
            />

            <Text accessibilityRole="header" style={[type.heading, { color: colors.textMuted }]}>
              Arrival window
            </Text>

            {offered.map((option) => (
              <Button
                key={option.slot}
                testID={`slot-${option.slot}`}
                label={option.label}
                hint={option.current ? 'The window it has now' : undefined}
                variant={!wholeDay && slot === option.slot ? 'primary' : 'secondary'}
                onPress={() => {
                  setSlot(option.slot);
                  setWholeDay(false);
                }}
              />
            ))}

            <Button
              testID="slot-all-day"
              label="All day"
              variant={wholeDay ? 'primary' : 'secondary'}
              onPress={() => setWholeDay(true)}
            />

            {hidden > 0 ? (
              <Text style={[type.caption, { color: colors.textMuted }]}>
                Windows that have already ended today are not shown. Pick
                another day for those.
              </Text>
            ) : null}
          </ScrollView>

          {refused ? (
            <Text
              accessibilityLiveRegion="polite"
              testID="reschedule-blocked"
              style={[type.caption, { color: colors.textMuted }]}
            >
              Pick a day and a window to move this visit.
            </Text>
          ) : null}

          <Button
            testID="reschedule-confirm"
            label={`Move to ${describeMove(next)}`}
            size="hero"
            disabled={Boolean(refused)}
            onPress={() => onConfirm(next)}
          />
          <View style={{ height: spacing.sm }} />
          <Button
            label="Cancel"
            variant="ghost"
            testID="reschedule-cancel"
            onPress={onCancel}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
});
