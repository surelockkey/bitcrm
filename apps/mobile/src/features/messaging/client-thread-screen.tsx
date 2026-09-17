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
import { Screen } from '../../ui/Screen';
import { Splash } from '../../ui/Splash';
import { clientDisplayName } from '../jobs/lib';
import { useJob, useMe } from '../jobs/hooks';
import { useQueue } from '../queue/queue-provider';
import { AudienceStrip } from './components/AudienceStrip';
import { Composer } from './components/Composer';
import { MessageBubble } from './components/MessageBubble';
import {
  useClientTextLookup,
  useJobClientThread,
  useSendToClient,
  useThreadFeed,
} from './hooks';
import {
  audienceChrome,
  clientFeedRows,
  describeReadError,
  flattenFeed,
  pendingLines,
  threadScreenEdges,
  type FeedRow,
} from './lib';

export interface ClientThreadScreenProps {
  dealId: string;
  /** Whether this screen is the one being looked at — drives the poll. */
  live?: boolean;
  onBack: () => void;
  /** Opens another job a line in this thread names. */
  onOpenJob?: (dealId: string) => void;
}

/**
 * The technician's text thread with the **client** of a job.
 *
 * SMS to clients is this account's largest channel by a distance — 78.4% of
 * 2.26M messages (`WORKIZ_MOBILE_APP.md` §1.5) — and the thing a technician
 * standing outside a door most wants is to say "I'm here" without leaving
 * their own number behind. The two templated notices ("On my way", "Running
 * late") cover the moments that repeat; this covers everything else, in the
 * technician's own words.
 *
 * It is a separate screen from the office thread, reached by a separate
 * button, writing a separate kind of outbox row, and it says on every one of
 * its own surfaces who is listening. The one mistake this screen must make
 * impossible is a technician thinking they are writing to dispatch.
 *
 * The thread is **not** marked read from here. A client conversation's read
 * state is the office's — `POST /conversations/:id/read` clears the whole
 * team's unread flag — and a technician glancing at a thread in a van must not
 * empty a dispatcher's inbox badge on their behalf.
 */
export function ClientThreadScreen({
  dealId,
  live = true,
  onBack,
  onOpenJob,
}: ClientThreadScreenProps) {
  const { colors, spacing, type } = useTheme();
  const { data: me } = useMe();
  const { data: deal, isPending: jobPending } = useJob(dealId);
  const clientName = deal ? clientDisplayName(deal) : '';
  const chrome = audienceChrome('client', { clientName });

  const thread = useJobClientThread(dealId);
  const feed = useThreadFeed(thread.data?.id, live);
  const lookup = useClientTextLookup(deal?.contactId);
  const { records, retry } = useQueue();
  const { send, canSend } = useSendToClient(dealId, deal?.contactId);

  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data?.pages]);
  // By kind AND by job: a text queued here is drawn here. The office thread
  // asks for `chat` rows and can never be handed one of these.
  const pending = useMemo(
    () => pendingLines(records, { kind: 'client_sms', dealId }),
    [records, dealId],
  );
  const rows = useMemo(
    () => clientFeedRows(messages, pending, me?.id, clientName),
    [messages, pending, me?.id, clientName],
  );

  // The server refuses an opted-out recipient with a 422 of its own; this is
  // so a technician learns it before typing rather than after.
  const optedOut = lookup.data?.optOut?.status === 'opted_out';
  // A job still on its way tells us nothing about whether it has a client, so
  // it must not be reported as one without — that is a different sentence, and
  // the wrong one sends a technician to ring the office for nothing.
  const clientUnknown = !canSend && (jobPending || !deal);
  // A lookup that failed says nothing either way, and is not a reason to stop
  // somebody writing — that call needs a signal and the outbox does not.
  const blocked = !canSend || optedOut;

  const submit = () => {
    setSending(true);
    void send(text)
      .then(() => setText(''))
      .catch(() =>
        Alert.alert(
          'Could not save your text',
          'The phone would not store it, so it has not been queued. Try again.',
        ),
      )
      .finally(() => setSending(false));
  };

  const error = thread.error ?? feed.error;
  const loading = thread.isLoading || (feed.isLoading && !messages.length);

  return (
    <Screen testID="client-thread-screen" edges={threadScreenEdges(true)}>
      <View
        style={[
          styles.header,
          { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.md },
        ]}
      >
        <Button label="Back" variant="ghost" onPress={onBack} testID="client-back" />
        <View style={styles.shrink}>
          <Text accessibilityRole="header" style={[type.heading, { color: colors.text }]}>
            {chrome.title}
          </Text>
          <Text style={[type.caption, { color: colors.textMuted }]}>
            {chrome.subtitle}
          </Text>
        </View>
      </View>

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
              testID="client-feed"
              style={styles.flex}
              inverted
              data={rows}
              keyExtractor={(row) => row.key}
              renderItem={({ item }) => (
                <Line
                  row={item}
                  onRetry={(id) => void retry('outbox', id)}
                  // A client's thread outlives one job: a line about another
                  // of their jobs leads to it, never back to this one.
                  onOpenJob={item.dealId && item.dealId !== dealId ? onOpenJob : undefined}
                />
              )}
              contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
              onEndReachedThreshold={0.4}
              onEndReached={() => {
                if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
              }}
              ListFooterComponent={
                feed.hasNextPage ? (
                  <View style={{ paddingBottom: spacing.md }}>
                    <Button
                      label="Load older messages"
                      testID="client-load-older"
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
              testID="client-empty"
              title="No texts yet"
              body={
                clientName
                  ? `Nothing has been sent to ${clientName} about this job. Anything you write here reaches them as a text from the company's number — never from yours.`
                  : "Nothing has been sent to this client yet. Anything you write here reaches them as a text from the company's number — never from yours."
              }
            />
          </View>
        )}

        {optedOut ? (
          <View
            testID="client-opted-out"
            accessibilityLiveRegion="polite"
            style={[
              styles.banner,
              {
                backgroundColor: colors.dangerSoft,
                borderColor: colors.danger,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                marginHorizontal: spacing.lg,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Text style={[type.caption, { color: colors.danger }]}>
              This client replied STOP, so texts to them are blocked. A call
              still works.
            </Text>
          </View>
        ) : clientUnknown ? (
          <View
            testID="client-job-loading"
            style={[
              styles.banner,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                marginHorizontal: spacing.lg,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Still finding out who this job is for. The box opens as soon as
              this phone has the job.
            </Text>
          </View>
        ) : !canSend ? (
          <View
            testID="client-no-contact"
            style={[
              styles.banner,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
                paddingHorizontal: spacing.lg,
                paddingVertical: spacing.md,
                marginHorizontal: spacing.lg,
                marginBottom: spacing.sm,
              },
            ]}
          >
            <Text style={[type.caption, { color: colors.textMuted }]}>
              This job has no client on it yet, so there is nobody to text. Ask
              the office.
            </Text>
          </View>
        ) : (
          <AudienceStrip chrome={chrome} />
        )}

        <Composer
          value={text}
          onChangeText={setText}
          onSend={submit}
          busy={sending}
          disabled={blocked}
          placeholder={chrome.placeholder}
          accessibilityLabel={chrome.inputLabel}
          hint={chrome.hint}
          testID="client-input"
          sendTestID="client-send"
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
  const { title, body } = describeReadError(error, 'client');
  return (
    <View style={styles.flex}>
      <EmptyState
        testID="client-error"
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
