import { useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../../lib/theme/theme-provider';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Screen, ScreenHeader } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { useMe } from '../jobs/hooks';
import { useQueue } from '../queue/queue-provider';
import { AudienceStrip } from './components/AudienceStrip';
import { Composer } from './components/Composer';
import { MessageBubble } from './components/MessageBubble';
import { useMarkThreadRead, useOfficeThread, useSendToOffice, useThreadFeed } from './hooks';
import {
  audienceChrome,
  describeReadError,
  feedRows,
  flattenFeed,
  messageSk,
  pendingLines,
  threadScreenEdges,
  type FeedRow,
} from './lib';

export interface ChatScreenProps {
  /**
   * Whether this screen is the one being looked at. Drives the poll — a thread
   * nobody is reading is not worth a request every ten seconds on a van's
   * cellular plan.
   */
  live?: boolean;
  /** The job the technician came from; the line carries it to the office. */
  dealId?: string;
  /** Drawn as a Back button when this was pushed over a job. */
  onBack?: () => void;
  /**
   * Opens a job a message names — Workiz's "View Job" from the Message Center
   * (§1.5). Never offered for the job the technician is already standing on.
   */
  onOpenJob?: (dealId: string) => void;
}

/**
 * The technician's one thread with the office.
 *
 * Workiz's Message Center is an inbox of many threads, and in this company's
 * own export 99.5% of in-app threads are the one between a technician and the
 * office (`docs/import/WORKIZ_MOBILE_APP.md` §1.5). So the tab opens that
 * thread directly rather than a list with one row in it — the same
 * conversation, one tap sooner.
 *
 * Everything else is Workiz's: newest at the bottom, scroll back for older,
 * day chips between the days, your own words on the right and the office's on
 * the left, the composer under the thread.
 */
export function ChatScreen({ live = true, dealId, onBack, onOpenJob }: ChatScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { data: me } = useMe();
  const meId = me?.id;
  // The same function the client thread reads its words from, so the two can
  // never converge on wording that leaves a technician guessing which is which.
  const chrome = audienceChrome('office', { fromJob: Boolean(dealId) });

  const thread = useOfficeThread(meId);
  const feed = useThreadFeed(thread.data?.id, live);
  const { records, retry } = useQueue();
  const { send } = useSendToOffice(thread.data?.id, dealId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data?.pages]);
  const pending = useMemo(() => pendingLines(records), [records]);
  const rows = useMemo(
    () => feedRows(messages, pending, meId),
    [messages, pending, meId],
  );

  // Read up to the newest line the office actually sent us — a line still in
  // the outbox has no sort key, because the server has never seen it.
  const newest = messages[0];
  useMarkThreadRead(thread.data?.id, newest ? messageSk(newest) : undefined, live);

  const submit = () => {
    setSending(true);
    void send(text)
      .then(() => setText(''))
      .catch(() =>
        Alert.alert(
          'Could not save your message',
          'The phone would not store it, so it has not been queued. Try again.',
        ),
      )
      .finally(() => setSending(false));
  };

  const error = thread.error ?? feed.error;
  // `isLoading`, not `isPending`: a query that is switched off — no session
  // yet, or no thread to read messages from — is *pending* for ever, and a
  // spinner that never resolves is the one thing this screen must not do.
  const loading = thread.isLoading || (feed.isLoading && !messages.length);

  return (
    <Screen testID="chat-screen" edges={threadScreenEdges(Boolean(onBack))}>
      {onBack ? (
        <View
          style={[
            styles.header,
            { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
          ]}
        >
          <Button label="Back" variant="ghost" onPress={onBack} testID="chat-back" />
          <View style={styles.shrink}>
            <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
              {chrome.title}
            </Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {chrome.subtitle}
            </Text>
          </View>
        </View>
      ) : (
        <ScreenHeader title="Messages" subtitle={chrome.subtitle} />
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {error && !rows.length ? (
          <FailedToLoad
            error={error}
            onRetry={() => {
              void thread.refetch();
              void feed.refetch();
            }}
          />
        ) : loading && !rows.length ? (
          <Splash />
        ) : rows.length ? (
          <>
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
                    marginTop: spacing.sm,
                  },
                ]}
              >
                <Text style={[type.caption, { color: colors.warning }]}>
                  Showing what this phone already has — it could not reach the
                  server just now.
                </Text>
              </View>
            ) : null}
            <FlatList
              testID="chat-feed"
              style={styles.flex}
              // Newest at the bottom, and the list starts there. The data is
              // newest-first exactly as the API hands it over, so nothing has
              // to be reversed to be read in the right order.
              inverted
              data={rows}
              keyExtractor={(row) => row.key}
              renderItem={({ item }) => (
                <Line
                  row={item}
                  onRetry={(id) => void retry('outbox', id)}
                  // Not for the job the technician came from: they are looking
                  // at it, and "View job" on it would lead back to itself.
                  onOpenJob={item.dealId && item.dealId !== dealId ? onOpenJob : undefined}
                />
              )}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
              // Scrolling back in time reaches the *end* of an inverted list.
              onEndReachedThreshold={0.4}
              onEndReached={() => {
                if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
              }}
              // In an inverted list the footer is drawn at the top, which is
              // where "older" belongs — and the button is kept as well as the
              // scroll trigger, because a thumb in a glove misses.
              ListFooterComponent={
                feed.hasNextPage ? (
                  <View style={{ paddingBottom: spacing.md }}>
                    <Button
                      label="Load older messages"
                      testID="chat-load-older"
                      variant="secondary"
                      busy={feed.isFetchingNextPage}
                      onPress={() => void feed.fetchNextPage()}
                    />
                  </View>
                ) : null
              }
            />
          </>
        ) : (
          <View style={styles.flex}>
            <EmptyState
              testID="chat-empty"
              title="No messages yet"
              body="Anything you write here goes straight to the office. They answer in the same thread."
            />
          </View>
        )}

        <AudienceStrip chrome={chrome} />

        <Composer
          value={text}
          onChangeText={setText}
          onSend={submit}
          busy={sending}
          placeholder={chrome.placeholder}
          accessibilityLabel={chrome.inputLabel}
          hint={chrome.hint}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

/** One row: the day chip that opens a day, then the bubble. */
function Line({
  row,
  onRetry,
  onOpenJob,
}: {
  row: FeedRow;
  onRetry: (queueId: string) => void;
  onOpenJob?: (dealId: string) => void;
}) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View style={{ gap: spacing.md }}>
      {row.dayLabel ? (
        <View style={styles.dayRow}>
          <Text
            style={[
              type.caption,
              {
                color: colors.textMuted,
                backgroundColor: colors.surfaceSunken,
                borderRadius: radius.pill,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.xs,
                overflow: 'hidden',
              },
            ]}
          >
            {row.dayLabel}
          </Text>
        </View>
      ) : null}
      <MessageBubble row={row} onRetry={onRetry} onOpenJob={onOpenJob} />
    </View>
  );
}

function FailedToLoad({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, body } = describeReadError(error);
  return (
    <View style={styles.flex}>
      <EmptyState
        testID="chat-error"
        tone="error"
        title={title}
        body={body}
        actionLabel="Try again"
        onAction={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center' },
  shrink: { flexShrink: 1 },
  banner: { borderWidth: 1, borderRadius: 12 },
  dayRow: { alignItems: 'center' },
});
