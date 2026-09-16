import { useCallback } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api/errors';
import { useTheme } from '../../lib/theme/theme-provider';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { JobCard } from './components/JobCard';
import { useMyJobs } from './hooks';
import type { Deal } from './types';

export interface JobsScreenProps {
  onOpenJob: (dealId: string) => void;
}

/**
 * The day list a technician works from: still open from earlier, today,
 * tomorrow, each later day, then the undated ones — the same grouping and the
 * same visit order as the web (`features/tech/lib.ts`), so the technician and
 * the dispatcher are looking at one route, not two.
 */
export function JobsScreen({ onOpenJob }: JobsScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { groups, ready, isLoading, isRefetching, error, refetch, deals } =
    useMyJobs();

  const sections = groups.map((g) => ({
    key: g.key,
    label: g.label,
    data: g.deals,
  }));

  const renderItem = useCallback(
    ({ item }: { item: Deal }) => <JobCard deal={item} onOpen={onOpenJob} />,
    [onOpenJob],
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 12 },
});
