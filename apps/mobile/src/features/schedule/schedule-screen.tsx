import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { AppHeader, HeaderAction } from '../../ui/AppHeader';
import { MenuButton } from '../../ui/Drawer';
import { Screen } from '../../ui/Screen';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { dayAfterRollover } from '../jobs/calendar';
import { DayPicker } from '../jobs/components/DayPicker';
import { useMyJobs } from '../jobs/hooks';
import { JobsScreen } from '../jobs/jobs-screen';
import { localDateIso, shiftDateIso } from '../jobs/lib';
import { summarizeQueue, tabBadge } from '../queue/lib';
import { useQueue } from '../queue/queue-provider';
import { DateRail } from './components/DateRail';
import { FilterSheet } from './components/FilterSheet';
import { HourGrid } from './components/HourGrid';
import { WeekStrip } from './components/WeekStrip';
import {
  isFiltering,
  jobCountLabel,
  jobsOnDay,
  makeMatcher,
  monthTitle,
  weekOf,
  NO_FILTER,
  type ScheduleFilter,
} from './lib';

export type ScheduleMode = 'timeline' | 'day';

export interface ScheduleScreenProps {
  onOpenJob: (dealId: string) => void;
  /** Overridable so a test can pin the day. */
  todayIso?: string;
  /** Which mode the tab opens on. Timeline, which is the list they know. */
  initialMode?: ScheduleMode;
}

/**
 * Schedule — the day, in the two shapes Workiz gives it
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4).
 *
 * **Timeline** is the list this app already had, with the date rail down the
 * left instead of the bar across the top, and it is what the tab opens on:
 * every technician using this app has worked from that list for months, and a
 * grid on first open would be a new screen where the old one was.
 *
 * **Day** is the hour grid. It answers what a list cannot — where the gaps
 * are — and it is a second way of looking at the same jobs, never the only
 * way to any of them.
 *
 * The header is theirs too: the month, back to today, a filter and a search.
 * What is missing from ours is the yellow `+` for a new job, because a
 * technician in BitCRM cannot create one, and `Tags` / `Type` in the filter,
 * because a deal here carries neither by a name a phone could show.
 *
 * Both modes read the same query the Home tab reads — one key, one cache
 * entry, no second request — and they share one day and one filter, so
 * switching between them can never change which jobs are on the screen.
 */
export function ScheduleScreen({
  onOpenJob,
  todayIso = localDateIso(),
  initialMode = 'timeline',
}: ScheduleScreenProps) {
  const { colors, spacing, type } = useTheme();
  const [mode, setMode] = useState<ScheduleMode>(initialMode);
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [picking, setPicking] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [filter, setFilter] = useState<ScheduleFilter>(NO_FILTER);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  // The phone spends the night on a charger with this mounted. Same rule as
  // the day list: a day the technician chose stays put, a day that was only
  // "today" follows the date over.
  const [anchorIso, setAnchorIso] = useState(todayIso);
  if (anchorIso !== todayIso) {
    setAnchorIso(todayIso);
    setSelectedIso((iso) => dayAfterRollover(iso, anchorIso, todayIso));
  }

  const { deals, techId, marks, isRefetching, refetch } = useMyJobs(
    todayIso,
    selectedIso,
  );
  const { records } = useQueue();

  const match = useMemo(() => makeMatcher(filter, query), [filter, query]);
  const week = useMemo(
    () => weekOf(selectedIso, todayIso, deals),
    [selectedIso, todayIso, deals],
  );
  const dayJobs = useMemo(
    () => jobsOnDay(deals, selectedIso, match, techId),
    [deals, selectedIso, match, techId],
  );

  const narrowed = isFiltering(filter, query);

  return (
    <Screen testID="schedule-screen">
      <AppHeader
        title={monthTitle(selectedIso)}
        left={<MenuButton marked={Boolean(tabBadge(summarizeQueue(records)))} />}
        right={
          <>
            <HeaderAction
              testID="schedule-today"
              label="Today"
              hint="Goes back to today"
              onPress={() => setSelectedIso(todayIso)}
            />
            <HeaderAction
              testID="schedule-filter"
              label="Filter"
              hint="Narrows the day by status"
              selected={filter.statuses.length > 0}
              onPress={() => setFiltering(true)}
            />
            <HeaderAction
              testID="schedule-search"
              label="Search"
              hint="Finds a job by number, client or address"
              selected={searching}
              onPress={() => {
                // Closing the field clears what it found: a filter a technician
                // cannot see is a list that is wrong for no visible reason.
                setSearching((open) => {
                  if (open) setQuery('');
                  return !open;
                });
              }}
            />
          </>
        }
      />

      {searching ? (
        <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
          <TextInput
            testID="schedule-search-field"
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Job number, client or address"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search your jobs"
            style={[
              type.body,
              styles.field,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                color: colors.text,
                paddingHorizontal: spacing.md,
              },
            ]}
          />
        </View>
      ) : null}

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <SegmentedControl
          testID="schedule-mode"
          accessibilityLabel="Schedule view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'timeline', label: 'Timeline', hint: 'Your day as a list' },
            { value: 'day', label: 'Day', hint: 'Your day hour by hour' },
          ]}
        />
      </View>

      {narrowed ? (
        <Text
          testID="schedule-filtered-note"
          accessibilityLiveRegion="polite"
          style={[
            type.caption,
            { color: colors.textMuted, paddingHorizontal: spacing.lg },
          ]}
        >
          Filtered. Not every job is shown.
        </Text>
      ) : null}

      {mode === 'timeline' ? (
        <View testID="schedule-timeline" style={styles.timeline}>
          <DateRail
            selectedIso={selectedIso}
            todayIso={todayIso}
            visits={dayJobs.length}
            onPrev={() => setSelectedIso((iso) => shiftDateIso(iso, -1))}
            onNext={() => setSelectedIso((iso) => shiftDateIso(iso, 1))}
            onPick={() => setPicking(true)}
          />
          <View style={styles.flex}>
            <JobsScreen
              embedded
              onOpenJob={onOpenJob}
              // Only when something is actually narrowed: it is also how the
              // list knows which kind of empty an empty day is.
              match={narrowed ? match : undefined}
              day={{ selectedIso, onSelect: setSelectedIso }}
            />
          </View>
        </View>
      ) : (
        <View testID="schedule-day" style={styles.flex}>
          <WeekStrip days={week} onSelect={setSelectedIso} />
          <Text
            style={[
              type.caption,
              { color: colors.textMuted, paddingHorizontal: spacing.lg },
            ]}
          >
            {jobCountLabel(dayJobs.length)}
          </Text>
          <HourGrid
            deals={dayJobs}
            techId={techId}
            onOpenJob={onOpenJob}
            refreshing={isRefetching}
            onRefresh={refetch}
          />
        </View>
      )}

      <DayPicker
        visible={picking}
        selectedIso={selectedIso}
        todayIso={todayIso}
        marks={marks}
        onCancel={() => setPicking(false)}
        onSelect={(dateIso) => {
          setSelectedIso(dateIso);
          setPicking(false);
        }}
      />
      <FilterSheet
        visible={filtering}
        deals={deals}
        filter={filter}
        onChange={setFilter}
        onClose={() => setFiltering(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  timeline: { flex: 1, flexDirection: 'row' },
  field: { minHeight: 56, borderWidth: 1, borderRadius: 12 },
});
