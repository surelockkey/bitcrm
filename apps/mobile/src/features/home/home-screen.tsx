import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { AppHeader } from '../../ui/AppHeader';
import { Card } from '../../ui/Card';
import { MenuButton } from '../../ui/Drawer';
import { Screen } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { useMe, useMyJobs } from '../jobs/hooks';
import { JobCard } from '../jobs/components/JobCard';
import { localDateIso } from '../jobs/lib';
import { summarizeQueue, tabBadge } from '../queue/lib';
import { useQueue } from '../queue/queue-provider';
import { HALF_MINUTE_MS, useNow } from '../timeclock/use-elapsed';
import { accountLine } from '../profile/app-nav';
import { Widget } from './components/Widget';
import { greeting, nextJob, statusCounts, totalOf, updatedAgoLabel } from './lib';

export interface HomeScreenProps {
  onOpenJob: (dealId: string) => void;
  /** The widget's `View all` — the Schedule tab. */
  onViewAll: () => void;
  /** Overridable so a test can pin the day. */
  todayIso?: string;
}

/**
 * Home — the screen the app opens on.
 *
 * It was the day list until this change. Workiz's is a dashboard: the
 * greeting, an **Upcoming work** card and a widget
 * (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §3), with the list living one tab
 * across on Schedule. That split is the point — the first screen answers
 * "what am I doing next and how is today going", in one glance, without
 * scrolling; the list answers "everything", which is a different question and
 * a different tab.
 *
 * Nothing here costs a request. The greeting comes from the session, and both
 * cards are read off the one day-list query the Schedule tab already uses —
 * same key, same cache entry, so opening the app fetches once, not twice, and
 * this screen keeps working with no signal.
 *
 * What Workiz has here and we do not: a widget picker (`Display: My jobs ⌄`),
 * because we have one widget and a chooser with one option is furniture; and
 * the header magnifier, because our search is over jobs and lives on Schedule
 * where the jobs are.
 */
export function HomeScreen({
  onOpenJob,
  onViewAll,
  todayIso = localDateIso(),
}: HomeScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { data: me } = useMe();
  const { deals, techId, ready, isLoading, isRefetching, refetch, updatedAt } =
    useMyJobs(todayIso);
  const { records } = useQueue();

  // The "updated N minutes ago" line has to age while the screen is open — a
  // technician who looks at this after lunch must not be told it is fresh.
  const now = useNow(HALF_MINUTE_MS);

  const next = nextJob(deals, todayIso, techId);
  const counts = statusCounts(deals, todayIso, techId);
  const total = totalOf(counts);
  const account = accountLine(me) || 'BitCRM';
  // The dot the Queue tab's badge became: unsent work, visible without opening
  // anything, from the screen the app starts on.
  const unsent = Boolean(tabBadge(summarizeQueue(records)));

  if (!ready || (isLoading && deals.length === 0)) {
    return (
      <Screen testID="home-screen">
        <AppHeader title={account} left={<MenuButton marked={unsent} />} />
        <Splash />
      </Screen>
    );
  }

  return (
    <Screen testID="home-screen">
      <AppHeader title={account} left={<MenuButton marked={unsent} />} />
      <ScrollView
        testID="home-scroll"
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
        <Text testID="home-greeting" style={[type.title, { color: colors.text }]}>
          {greeting(me?.firstName)}
        </Text>

        <View style={{ gap: spacing.sm }}>
          <Text
            accessibilityRole="header"
            style={[type.heading, { color: colors.textMuted }]}
          >
            Upcoming work
          </Text>
          {next ? (
            <JobCard deal={next} onOpen={onOpenJob} />
          ) : (
            <Card testID="home-upcoming-empty">
              <Text style={[type.body, { color: colors.textMuted }]}>
                Nothing on your schedule.
              </Text>
            </Card>
          )}
        </View>

        <Widget
          testID="home-widget"
          title="My jobs"
          updated={updatedAgoLabel(updatedAt, now)}
          refreshing={isRefetching}
          onRefresh={refetch}
          onViewAll={onViewAll}
        >
          {total === 0 ? (
            <Text testID="home-widget-empty" style={[type.body, { color: colors.textMuted }]}>
              No jobs to count yet.
            </Text>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {counts.map((row) => (
                <View
                  key={String(row.status)}
                  testID={`home-count-${row.status}`}
                  accessibilityLabel={`${row.label}, ${row.count}`}
                  style={styles.countRow}
                >
                  <Text style={[type.body, styles.flexShrink, { color: colors.text }]}>
                    {row.label}
                  </Text>
                  <Text style={[type.title, { color: colors.text }]}>{row.count}</Text>
                </View>
              ))}
            </View>
          )}
        </Widget>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flexShrink: { flexShrink: 1 },
});
