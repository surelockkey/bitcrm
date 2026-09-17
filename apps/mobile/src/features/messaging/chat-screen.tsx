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
  clientFeedRows,
  describeReadError,
  feedRows,
  flattenFeed,
  messageSk,
  pendingLines,
  threadScreenEdges,
  type FeedRow,
  type ThreadAudience,
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
  /**
   * Open this exact thread, instead of resolving the technician's own office
   * thread. What the Messages list passes: it has already been told which
   * conversation the row is, and a second lookup could only disagree with it.
   */
  conversationId?: string;
  /**
   * Who is on the other end. `client` swaps every rule about authorship, the
   * side a bubble sits on and the words above the box — see `clientFeedRows`
   * and `audienceChrome`. Defaults to the office, which is what the tab and
   * the job route have always opened.
   */
  audience?: ThreadAudience;
  /** The client's name, for a `client` thread opened from the list. */
  clientName?: string;
  /**
   * The contact the thread belongs to. Only used to find the texts still in
   * the outbox for this client, so a line queued from one of their jobs is
   * drawn in the one conversation they have.
   */
  clientContactId?: string;
  /**
   * Why this thread cannot be written to from here, and the way that is. Set
   * for a client thread reached from the Messages list: texting a client is
   * authorised by the server against the **job**, and the list is not standing
   * on one. Absent, the composer is live.
   */
  readOnly?: { reason: string; actionLabel?: string; onAction?: () => void };
}

/**
 * One thread, drawn the way Workiz draws one: newest at the bottom, scroll
 * back for older, day chips between the days, your own words on the right and
 * the other side's on the left, the composer under the thread.
 *
 * Which thread is a parameter. With nothing passed it resolves the
 * technician's own thread with the office — what the job routes have always
 * opened. Given a `conversationId` it opens that one, and given
 * `audience: 'client'` it reads it as a client's thread, where every rule
 * about who wrote what is different (`clientFeedRows`). Both are this one
 * screen on purpose: read state, day chips, the outbox's pending lines and
 * their retry live in one place, so the thread a technician reaches from the
 * list and the thread they reach from a job cannot behave differently.
 */
export function ChatScreen({
  live = true,
  dealId,
  onBack,
  onOpenJob,
  conversationId,
  audience = 'office',
  clientName,
  clientContactId,
  readOnly,
}: ChatScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { data: me } = useMe();
  const meId = me?.id;
  const client = audience === 'client';
  // Both threads read their words from the same function, so the two can never
  // converge on wording that leaves a technician guessing which is which.
  const chrome = audienceChrome(audience, {
    ...(clientName ? { clientName } : {}),
    fromJob: Boolean(dealId),
  });

  // Only when the caller did not already name the thread; a lookup that could
  // only agree with what we were handed is a request for nothing.
  const own = useOfficeThread(conversationId ? undefined : meId);
  const threadId = conversationId ?? own.data?.id;
  const feed = useThreadFeed(threadId, live);
  const { records, retry } = useQueue();
  const { send } = useSendToOffice(threadId, dealId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data?.pages]);
  const pending = useMemo(
    // A client thread reached from the list is read-only, so nothing is queued
    // here — but a text queued from one of this client's jobs belongs in the
    // one conversation they have, and it is drawn by the contact it is
    // addressed to rather than by the job it was sent from.
    () =>
      pendingLines(
        records,
        client
          ? { kind: 'client_sms', ...(clientContactId ? { contactId: clientContactId } : {}) }
          : { kind: 'chat' },
      ),
    [records, client, clientContactId],
  );
  const rows = useMemo(
    () =>
      client
        ? clientFeedRows(messages, pending, meId, clientName)
        : feedRows(messages, pending, meId),
    [client, messages, pending, meId, clientName],
  );

  // Read up to the newest line the office actually sent us — a line still in
  // the outbox has no sort key, because the server has never seen it. Never on
  // a client thread: that read marker is the office's, and a glance from a van
  // must not empty a dispatcher's badge on their behalf.
  const newest = messages[0];
  useMarkThreadRead(
    client ? undefined : threadId,
    newest ? messageSk(newest) : undefined,
    live,
  );

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

  const error = own.error ?? feed.error;
  // `isLoading`, not `isPending`: a query that is switched off — no session
  // yet, or no thread to read messages from — is *pending* for ever, and a
  // spinner that never resolves is the one thing this screen must not do.
  const loading = own.isLoading || (feed.isLoading && !messages.length);

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
            audience={audience}
            onRetry={() => {
              void own.refetch();
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
              body={
                client
                  ? `Nothing has been sent to ${clientName?.trim() || 'this client'} yet.`
                  : 'Anything you write here goes straight to the office. They answer in the same thread.'
              }
            />
          </View>
        )}

        <AudienceStrip chrome={chrome} />

        {readOnly ? (
          <ReadOnlyFooter readOnly={readOnly} />
        ) : (
          <Composer
            value={text}
            onChangeText={setText}
            onSend={submit}
            busy={sending}
            placeholder={chrome.placeholder}
            accessibilityLabel={chrome.inputLabel}
            hint={chrome.hint}
          />
        )}
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

/**
 * What stands where the composer would, when this thread cannot be written to
 * from here.
 *
 * It says why in one sentence and offers the way that it can be — never an
 * input that looks live and refuses on Send, and never a thread that simply
 * has no box and leaves a technician tapping at the bottom of the screen
 * wondering what is broken.
 */
function ReadOnlyFooter({
  readOnly,
}: {
  readOnly: NonNullable<ChatScreenProps['readOnly']>;
}) {
  const { colors, radius, spacing, type } = useTheme();
  return (
    <View
      testID="chat-read-only"
      accessibilityLiveRegion="polite"
      style={{
        paddingHorizontal: spacing.lg,
        paddingBottom: spacing.md,
        gap: spacing.sm,
      }}
    >
      <View
        style={[
          styles.banner,
          {
            backgroundColor: colors.surfaceSunken,
            borderColor: colors.border,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm,
          },
        ]}
      >
        <Text style={[type.caption, { color: colors.textMuted }]}>
          {readOnly.reason}
        </Text>
      </View>
      {readOnly.actionLabel && readOnly.onAction ? (
        <Button
          label={readOnly.actionLabel}
          testID="chat-read-only-action"
          variant="secondary"
          onPress={readOnly.onAction}
        />
      ) : null}
    </View>
  );
}

function FailedToLoad({
  error,
  audience,
  onRetry,
}: {
  error: unknown;
  audience: ThreadAudience;
  onRetry: () => void;
}) {
  const { title, body } = describeReadError(error, audience);
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
