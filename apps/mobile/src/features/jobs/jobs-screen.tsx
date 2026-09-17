import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  PanResponder,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { useTheme } from '../../lib/theme/theme-provider';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { DayBar } from './components/DayBar';
import { DayPicker } from './components/DayPicker';
import { JobCard } from './components/JobCard';
import { dayAfterRollover, daySwipeHandlers } from './calendar';
import { useMyJobs } from './hooks';
import { localDateIso, shiftDateIso } from './lib';
import type { Deal } from './types';

export interface JobsScreenProps {
  onOpenJob: (dealId: string) => void;
  /**
   * The day, when something above owns it.
   *
   * Schedule's two modes share one date: a week strip and a list keeping
   * separate ideas of "the day" is the kind of drift a technician notices only
   * after driving to the wrong one. Absent, the list keeps its own day, which
   * is what the standalone Jobs screen does.
   */
  day?: { selectedIso: string; onSelect: (iso: string) => void };
  /**
   * Schedule's filter and search, when one is set.
   *
   * Applied to the list on its way to the screen, never to the cache — the day
   * list is the only copy of these jobs this phone has, and a filter must not
   * be able to evict any of it. Absent when nothing is narrowed, which is what
   * lets an empty day say which kind of empty it is.
   */
  match?: (deal: Deal) => boolean;
  /**
   * Drawn without the page furniture: no title bar, no day bar, no calendar.
   * Schedule supplies all three around it, and two of anything is worse than
   * one.
   */
  embedded?: boolean;
  /** Drawn as Back when this is a screen pushed off the menu rather than a tab. */
  onBack?: () => void;
  /**
   * Which day counts as today.
   *
   * Schedule owns it while the list is embedded: its header, its date rail and
   * its hour grid all anchor to one date, and a list quietly anchored to a
   * *different* one is how the two halves of that tab come to disagree about
   * what "Today" means the night the date rolls over. Defaults to this phone's
   * own day, which is what the standalone Jobs screen uses.
   */
  todayIso?: string;
}

/**
 * The day list a technician works from: still open from earlier, today,
 * tomorrow, each later day, then the undated ones — the same grouping and the
 * same visit order as the web (`features/tech/lib.ts`), so the technician and
 * the dispatcher are looking at one route, not two.
 *
 * Days are moved between by swiping the list sideways, by the two arrows, or
 * from the calendar — Workiz's Schedule tab, where the dates scroll and the
 * calendar expands (§1.3). None of it costs a request: the whole assigned set
 * is already on the phone, so yesterday and next Tuesday are as available
 * underground as today is.
 *
 * It is used in two places: on its own as **Jobs**, off the menu, and embedded
 * as the **Timeline** half of the Schedule tab
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §4). One list, so the two can
 * never disagree about what today holds.
 */
export function JobsScreen({
  onOpenJob,
  day,
  match,
  embedded = false,
  onBack,
  todayIso = localDateIso(),
}: JobsScreenProps) {
  const { colors, spacing, type } = useTheme();
  const [ownIso, setOwnIso] = useState(todayIso);
  const selectedIso = day ? day.selectedIso : ownIso;
  const [picking, setPicking] = useState(false);
  // Which "today" the selection above was made against. The app is left
  // mounted overnight, so the day underneath it changes without anybody
  // touching the phone — and a list still showing the day that has just become
  // yesterday hides the whole of today's work. Derived during the render that
  // notices the change rather than in an effect, so the list is never painted
  // on the wrong day for a frame (the same reason `MonthGrid` does it).
  //
  // Only when the day is this screen's own. When Schedule owns it, Schedule
  // owns the rollover too — writing a parent's state from a child's render is
  // exactly the update React warns about.
  const [anchorIso, setAnchorIso] = useState(todayIso);
  if (!day && anchorIso !== todayIso) {
    setAnchorIso(todayIso);
    setOwnIso((iso) => dayAfterRollover(iso, anchorIso, todayIso));
  }

  // The swipe responder is built once and lives for the life of the screen, so
  // the day it steps from has to be read at the moment of the swipe rather
  // than captured when the screen mounted — embedded, it changes above us.
  const commit = useRef<(iso: string) => void>(() => {});
  commit.current = day ? day.onSelect : setOwnIso;
  const current = useRef(selectedIso);
  current.current = selectedIso;

  const {
    groups: allGroups,
    ready,
    isLoading,
    isRefetching,
    error,
    refetch,
    deals,
    marks,
    selectedVisits,
  } = useMyJobs(todayIso, selectedIso);

  const step = useCallback((days: number) => {
    commit.current(shiftDateIso(current.current, days));
  }, []);

  const pan = useRef(PanResponder.create(daySwipeHandlers(step))).current;

  const groups = useMemo(
    () =>
      match ? allGroups.map((g) => ({ ...g, deals: g.deals.filter(match) })) : allGroups,
    [allGroups, match],
  );

  const sections = useMemo(
    () => groups.map((g) => ({ key: g.key, label: g.label, data: g.deals })),
    [groups],
  );

  const renderItem = useCallback(
    ({ item }: { item: Deal }) => <JobCard deal={item} onOpen={onOpenJob} />,
    [onOpenJob],
  );

  // Embedded, the page furniture belongs to Schedule: it draws the header, the
  // date rail and the calendar, and a second set underneath would be two of
  // everything.
  const shell = (children: ReactNode) =>
    embedded ? (
      <View testID="jobs-screen" style={styles.flex}>
        {children}
      </View>
    ) : (
      <Screen testID="jobs-screen">
        <ScreenHeader title="My jobs" onBack={onBack} />
        {children}
      </Screen>
    );

  const dayBar = embedded ? null : (
    <DayBar
      selectedIso={selectedIso}
      todayIso={todayIso}
      visits={selectedVisits}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onPick={() => setPicking(true)}
      onToday={() => commit.current(todayIso)}
    />
  );

  const calendar = embedded ? null : (
    <DayPicker
      visible={picking}
      selectedIso={selectedIso}
      todayIso={todayIso}
      marks={marks}
      onCancel={() => setPicking(false)}
      onSelect={(dateIso) => {
        commit.current(dateIso);
        setPicking(false);
      }}
    />
  );

  // Still resolving who the technician is: the list is loading, not empty.
  if (!ready || (isLoading && deals.length === 0 && !error)) {
    return shell(<Splash />);
  }

  // A failure with nothing cached is the only case worth a whole screen; with
  // a cached day behind it, the list stays up and the banner explains itself.
  if (error && deals.length === 0) {
    const offline = error instanceof ApiError && error.status === 0;
    return shell(
      <EmptyState
        testID="jobs-error"
        tone="error"
        title={offline ? 'No signal' : 'Could not load your jobs'}
        body={
          offline
            ? 'Your jobs will appear as soon as the phone has a connection. Anything you do in the meantime is saved and sent later.'
            : error instanceof ApiError
              ? error.message
              : 'Something went wrong on the way to the server.'
        }
        actionLabel="Try again"
        onAction={refetch}
      />,
    );
  }

  return shell(
    <>
      {dayBar}
      {error ? (
        <View
          accessibilityLiveRegion="polite"
          style={[
            styles.banner,
            {
              backgroundColor: colors.warningSoft,
              borderColor: colors.warning,
              paddingHorizontal: spacing.lg,
              paddingVertical: spacing.md,
              marginHorizontal: spacing.lg,
            },
          ]}
        >
          <Text style={[type.caption, { color: colors.warning }]}>
            Showing the last list this phone downloaded — it could not reach the
            server just now.
          </Text>
        </View>
      ) : null}
      <View testID="jobs-swipe" style={styles.flex} {...pan.panHandlers}>
        <SectionList
          testID="jobs-list"
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text
              accessibilityRole="header"
              style={[
                type.heading,
                { color: colors.textMuted, marginTop: spacing.sm },
              ]}
            >
              {section.label}
            </Text>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <Text style={[type.body, { color: colors.textMuted }]}>
                {/* Two different empties. A day a filter emptied is not a day
                    with no work on it, and telling a technician dispatch has
                    nothing for them when they have simply typed a name into a
                    search box is the kind of wrong that gets phoned in. */}
                {match
                  ? 'Nothing on this day matches what you are looking for.'
                  : 'Nothing booked. Dispatch will let you know.'}
              </Text>
            ) : null
          }
        />
      </View>
      {calendar}
    </>,
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 12 },
  flex: { flex: 1 },
});
