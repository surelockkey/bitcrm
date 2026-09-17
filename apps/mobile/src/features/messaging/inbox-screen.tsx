import { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { useMyJobs } from '../jobs/hooks';
import { ConversationRow } from './components/ConversationRow';
import { FilterChips } from './components/FilterChips';
import { useInbox } from './inbox-hooks';
import {
  describeInboxError,
  emptyStateFor,
  type InboxCategory,
  type InboxRow,
} from './inbox-lib';

export interface InboxScreenProps {
  /** Whether this screen is the one being looked at — drives the poll. */
  live?: boolean;
  /** Opens a thread. The route decides how; the list only says which. */
  onOpenThread: (row: InboxRow) => void;
}

/**
 * Messages: one list of conversations with four filter chips, the way Workiz
 * does it on a phone (`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §5).
 *
 * Until now this tab was a single thread with the office. Workiz's own app has
 * no such screen: it has `Messages`, a search, and the chips `All` ·
 * `Requests` · `Clients` · `Team`, where Team *is* the office. Their shape is
 * both simpler for a technician and strictly larger — it reaches the client
 * conversations, which this app could previously only open from inside a job
 * and never see the existence of.
 *
 * What the chips mean is the web Inbox's mapping, kind for kind
 * (`apps/web/features/messaging/lib.ts:76-124`), so the two clients name the
 * same threads with the same words. All four are drawn whatever the data says
 * — the live app printed `Requests (0)` on a technician account with nothing
 * assigned to it; see `CATEGORY_ORDER`.
 */
export function InboxScreen({ live = true, onOpenThread }: InboxScreenProps) {
  const { colors, radius, spacing, touch, type } = useTheme();
  const [category, setCategory] = useState<InboxCategory>('all');
  const [search, setSearch] = useState('');

  // The technician's own jobs, already downloaded and persisted for the day
  // list — the only source of client names that survives a tunnel. One cache
  // entry, shared with the day list; this costs no request.
  const { deals } = useMyJobs();
  const inbox = useInbox(category, search, deals, live);

  const searching = search.trim().length > 0;
  const empty = emptyStateFor(category, searching);

  return (
    <Screen testID="inbox-screen">
      <ScreenHeader title="Messages" />

      <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
        <TextInput
          testID="inbox-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search messages"
          placeholderTextColor={colors.textMuted}
          accessibilityLabel="Search messages"
          autoCorrect={false}
          // A technician types a surname or a street, never a sentence.
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[
            type.body,
            {
              minHeight: touch.min,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              backgroundColor: colors.surface,
              color: colors.text,
              paddingHorizontal: spacing.md,
            },
          ]}
        />
      </View>

      <FilterChips
        categories={inbox.categories}
        counts={inbox.counts}
        value={category}
        onChange={setCategory}
      />

      {inbox.access.notice ? (
        <Notice testID="inbox-partial" text={inbox.access.notice} />
      ) : null}

      {inbox.staleError ? (
        <Notice
          testID="inbox-stale"
          text="Showing what this phone already has — it could not reach the server just now."
        />
      ) : null}

      {inbox.access.blocked ? (
        <View style={styles.flex}>
          <EmptyState
            testID="inbox-blocked"
            tone="error"
            title="Not your inbox"
            body="This account is not allowed to read messages. Ask dispatch to check your role."
            actionLabel="Try again"
            onAction={inbox.refetch}
          />
        </View>
      ) : inbox.error ? (
        <FailedToLoad error={inbox.error} onRetry={inbox.refetch} />
      ) : inbox.loading ? (
        <Splash />
      ) : inbox.visible.length ? (
        <FlatList
          testID="inbox-list"
          style={styles.flex}
          data={inbox.visible}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <ConversationRow row={item} onPress={onOpenThread} />
          )}
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          // Workiz's own list refreshes with a pull; so does every other list
          // in this app (`_MOBILE_UI_PARITY_REQUIREMENT.md`).
          refreshing={inbox.isRefetching}
          onRefresh={inbox.refetch}
          onEndReachedThreshold={0.4}
          onEndReached={inbox.fetchNextPage}
          ListFooterComponent={
            inbox.hasNextPage ? (
              <Button
                label="Load older conversations"
                testID="inbox-load-older"
                variant="secondary"
                busy={inbox.isFetchingNextPage}
                onPress={inbox.fetchNextPage}
              />
            ) : null
          }
        />
      ) : (
        <View style={styles.flex}>
          <EmptyState testID="inbox-empty" title={empty.title} body={empty.body} />
        </View>
      )}
    </Screen>
  );
}

function FailedToLoad({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, body } = describeInboxError(error);
  return (
    <View style={styles.flex}>
      <EmptyState
        testID="inbox-error"
        tone="error"
        title={title}
        body={body}
        actionLabel="Try again"
        onAction={onRetry}
      />
    </View>
  );
}

/** One line under the chips: something is missing from the list, and why. */
function Notice({ testID, text }: { testID: string; text: string }) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View
      testID={testID}
      accessibilityLiveRegion="polite"
      style={[
        styles.notice,
        {
          backgroundColor: colors.warningSoft,
          borderColor: colors.warning,
          borderRadius: radius.md,
          marginHorizontal: spacing.lg,
          marginBottom: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
      ]}
    >
      <Text style={[type.caption, { color: colors.warning }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  notice: { borderWidth: 1 },
});
