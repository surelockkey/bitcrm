import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { Screen } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { localDateIso } from '../jobs/lib';
import { ClockCard } from './components/ClockCard';
import { useClockState, useDealNumber, useTimesheet } from './hooks';
import {
  clockStartedAt,
  describeEntry,
  formatElapsedShort,
  formatHoursMinutes,
  type ClockDayGroup,
} from './lib';
import { SECOND_MS, useElapsed } from './use-elapsed';
import type { TimeClockEntry } from './types';

export interface TimesheetScreenProps {
  onBack: () => void;
  /** The Queue tab, for a clock row that did not make it. */
  onOpenQueue?: () => void;
  /** Overridable so a test can pin the day. */
  todayIso?: string;
}

/**
 * Timesheet — Workiz's Menu → Timesheets (`WORKIZ_MOBILE_APP.md` §1.7, §1.12).
 *
 * Its own screen rather than a tab, and reached from Profile, because that is
 * where Workiz keeps it: the help centre lists Timesheets among the Settings
 * entries a technician opens from the menu, not among the bottom tabs (§1.12).
 * It does the two things the article says that screen does — clock in for the
 * day, and read the day back — plus the week, which the plan asks for.
 *
 * What the screen shows, top to bottom: the clock itself (the reason anyone
 * opens this), today's and this week's totals, then the week day by day,
 * newest first.
 */
export function TimesheetScreen({
  onBack,
  onOpenQueue,
  todayIso = localDateIso(),
}: TimesheetScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { days, todayMinutes, weekMinutes, isLoading, isRefetching, error, stale, refetch } =
    useTimesheet(todayIso);
  const { state } = useClockState();
  const runningSince = clockStartedAt(state);
  const runningMs = useElapsed(runningSince, SECOND_MS);

  return (
    <Screen testID="timesheet-screen">
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
        ]}
      >
        <Button label="Back" variant="ghost" onPress={onBack} testID="timesheet-back" />
        <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
          Timesheet
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        <ClockCard onOpenQueue={onOpenQueue} />

        <Card testID="timesheet-totals">
          <View style={[styles.totals, { gap: spacing.lg }]}>
            <Total label="Today" minutes={todayMinutes} testID="total-today" />
            <Total label="This week" minutes={weekMinutes} testID="total-week" />
          </View>
          {runningSince ? (
            /*
             * The running clock is shown beside the totals and counted in
             * neither. A total that climbed while the technician watched it
             * would disagree with every number the office has, and "how many
             * hours have I banked" is a different question from "how long have
             * I been on this one".
             */
            <Text
              testID="running-note"
              style={[type.caption, { color: colors.textMuted }]}
            >
              {`Plus ${formatElapsedShort(runningMs)} running now — counted once you clock out.`}
            </Text>
          ) : null}
          <Text style={[type.caption, { color: colors.textMuted }]}>
            Monday to Sunday, the same week the office sees.
          </Text>
        </Card>

        {stale ? (
          <Text
            accessibilityLiveRegion="polite"
            testID="timesheet-stale"
            style={[type.caption, { color: colors.warning }]}
          >
            Showing the last timesheet this phone downloaded — it could not reach
            the server just now.
          </Text>
        ) : null}

        {isLoading ? <Splash /> : null}

        {!isLoading && error && days.length === 0 ? (
          <EmptyState
            testID="timesheet-error"
            tone="error"
            title={
              error instanceof ApiError && error.status === 0
                ? 'No signal'
                : 'Could not load your timesheet'
            }
            body={
              error instanceof ApiError && error.status === 0
                ? 'Your hours will appear as soon as the phone has a connection. Clocking in and out still works.'
                : error instanceof ApiError
                  ? error.message
                  : 'Something went wrong on the way to the server.'
            }
            actionLabel="Try again"
            onAction={refetch}
          />
        ) : null}

        {!isLoading && !error && days.length === 0 ? (
          <EmptyState
            testID="timesheet-empty"
            title="No hours this week yet"
            body="Everything you clock in and out of shows up here."
          />
        ) : null}

        {days.map((day) => (
          <DaySection key={day.dateIso} day={day} />
        ))}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}

function Total({
  label,
  minutes,
  testID,
}: {
  label: string;
  minutes: number;
  testID: string;
}) {
  const { colors, type } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}, ${formatHoursMinutes(minutes)}`}
      style={styles.total}
    >
      <Text style={[type.caption, { color: colors.textMuted }]}>{label}</Text>
      <Text
        testID={testID}
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[type.title, styles.figure, { color: colors.text }]}
      >
        {formatHoursMinutes(minutes)}
      </Text>
    </View>
  );
}

function DaySection({ day }: { day: ClockDayGroup }) {
  const { colors, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.dayHeader}>
        <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
          {day.label}
        </Text>
        <Text style={[type.label, styles.figure, { color: colors.textMuted }]}>
          {formatHoursMinutes(day.minutes)}
        </Text>
      </View>
      {day.entries.map((entry) => (
        <EntryRow key={entry.id} entry={entry} />
      ))}
    </View>
  );
}

/**
 * One entry: when it ran, how long, and which job if it was on one.
 *
 * Wall-clock times rather than "2 hours ago" — a technician querying a short
 * day with the office has to be able to read the same numbers the office is
 * looking at, which is the rule the job stamps already follow.
 */
function EntryRow({ entry }: { entry: TimeClockEntry }) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const { span, length, running } = describeEntry(entry);
  const jobNumber = useDealNumber(entry.dealId);
  const job = entry.dealId ? `Job ${jobNumber ?? entry.dealId}` : 'For the day';

  return (
    <View
      testID="timesheet-entry"
      accessible
      accessibilityLabel={`${span}, ${running ? 'still running' : length}, ${job}`}
      style={[
        styles.entry,
        {
          minHeight: touch.min,
          gap: spacing.lg,
          padding: spacing.lg,
          borderRadius: radius.lg,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.entryText}>
        <Text style={[type.body, { color: colors.text }]}>{span}</Text>
        <Text style={[type.caption, { color: colors.textMuted }]}>{job}</Text>
      </View>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          type.label,
          styles.figure,
          { color: running ? colors.success : colors.text },
        ]}
      >
        {length}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center' },
  totals: { flexDirection: 'row' },
  total: { flexShrink: 1 },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth,
  },
  entryText: { flexShrink: 1 },
  figure: { fontVariant: ['tabular-nums'] },
});
