import { useCallback, useMemo, useRef, useState } from 'react';
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
 */
export function JobsScreen({ onOpenJob }: JobsScreenProps) {
  const { colors, spacing, type } = useTheme();
  const todayIso = localDateIso();
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [picking, setPicking] = useState(false);
  // Which "today" the selection above was made against. The app is left
  // mounted overnight, so the day underneath it changes without anybody
  // touching the phone — and a list still showing the day that has just become
  // yesterday hides the whole of today's work. Derived during the render that
  // notices the change rather than in an effect, so the list is never painted
  // on the wrong day for a frame (the same reason `MonthGrid` does it).
  const [anchorIso, setAnchorIso] = useState(todayIso);
  if (anchorIso !== todayIso) {
    setAnchorIso(todayIso);
    setSelectedIso((iso) => dayAfterRollover(iso, anchorIso, todayIso));
  }
  const {
    groups,
    ready,
    isLoading,
    isRefetching,
    error,
    refetch,
    deals,
    marks,
    selectedVisits,
  } = useMyJobs(todayIso, selectedIso);

  const step = useCallback(
    (days: number) => setSelectedIso((iso) => shiftDateIso(iso, days)),
    [],
  );

  // `step` is stable, so the responder is built once and keeps working for
  // every day the technician moves to.
  const pan = useRef(PanResponder.create(daySwipeHandlers(step))).current;

  const sections = useMemo(
    () => groups.map((g) => ({ key: g.key, label: g.label, data: g.deals })),
    [groups],
  );

  const renderItem = useCallback(
    ({ item }: { item: Deal }) => <JobCard deal={item} onOpen={onOpenJob} />,
    [onOpenJob],
  );

  const dayBar = (
    <DayBar
      selectedIso={selectedIso}
      todayIso={todayIso}
      visits={selectedVisits}
      onPrev={() => step(-1)}
      onNext={() => step(1)}
      onPick={() => setPicking(true)}
      onToday={() => setSelectedIso(todayIso)}
    />
  );

  const calendar = (
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
  );

  // Still resolving who the technician is: the list is loading, not empty.
  if (!ready || (isLoading && deals.length === 0 && !error)) {
    return (
      <Screen testID="jobs-screen">
        <ScreenHeader title="My jobs" />
        <Splash />
      </Screen>
    );
  }

  // A failure with nothing cached is the only case worth a whole screen; with
  // a cached day behind it, the list stays up and the banner explains itself.
  if (error && deals.length === 0) {
    const offline = error instanceof ApiError && error.status === 0;
    return (
      <Screen testID="jobs-screen">
        <ScreenHeader title="My jobs" />
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
        />
      </Screen>
    );
  }

  return (
    <Screen testID="jobs-screen">
      <ScreenHeader title="My jobs" />
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
                Nothing booked. Dispatch will let you know.
              </Text>
            ) : null
          }
        />
      </View>
      {calendar}
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 12 },
  flex: { flex: 1 },
});
