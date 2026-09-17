import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ChatScreen } from '../../../../src/features/messaging/chat-screen';
import { useConversation } from '../../../../src/features/messaging/inbox-hooks';
import {
  audienceOfKind,
  partyNames,
  rowTitle,
  textableDealId,
} from '../../../../src/features/messaging/inbox-lib';
import { useMyJobs } from '../../../../src/features/jobs/hooks';
import { EmptyState } from '../../../../src/ui/EmptyState';
import { Screen } from '../../../../src/ui/Screen';
import { Splash } from '../../../../src/ui/Splash';

/**
 * `bitcrm://chat/conversation/<id>` — a thread opened from the Messages list.
 *
 * One route for every row, because the list is one list: the office thread,
 * a group and a client's thread all come through here and the conversation's
 * own `kind` decides how it is read. Pushed over the tabs, so Back returns to
 * the list at the chip and the scroll position it was left at.
 *
 * A client's thread is opened **read-only**, and that is a decision rather
 * than an omission. `POST /messaging/messages` authorises a text against the
 * job it names (`send.service.ts:942-950`), and the only job this screen
 * knows is `lastDealId` — the job the *thread* last touched, which under
 * `assigned_only` may be a job of that client this technician is not on. A
 * text queued against it would sit in the outbox as a permanent failure and
 * the client would never read the words. So the thread reads here and is
 * written from the job, which is where the server can say yes.
 */
export default function ConversationRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const focused = useIsFocused();
  const { conversation, loading, error } = useConversation(id);
  const { deals } = useMyJobs();

  const back = () => (router.canGoBack() ? router.back() : router.replace('/chat'));

  if (!id) {
    return (
      <Screen>
        <EmptyState
          title="No conversation in that link"
          actionLabel="Back to messages"
          onAction={() => router.replace('/chat')}
        />
      </Screen>
    );
  }

  if (!conversation) {
    return (
      <Screen>
        {loading ? (
          <Splash />
        ) : (
          <EmptyState
            testID="conversation-missing"
            tone="error"
            title={error ? 'Could not open that conversation' : 'That conversation is gone'}
            body={
              error
                ? 'It may belong to a job you are not on. Ask dispatch, or open it from the job.'
                : 'It is not on the list this phone has.'
            }
            actionLabel="Back to messages"
            onAction={back}
          />
        )}
      </Screen>
    );
  }

  const audience = audienceOfKind(conversation.kind);
  const title = rowTitle(conversation, partyNames(deals));
  // One of *his* jobs with this client, never simply the job the thread last
  // touched: that one is often another technician's, and the server authorises
  // the text against it. See `textableDealId`.
  const job = textableDealId(conversation, deals);

  return (
    <ChatScreen
      live={focused}
      conversationId={conversation.id}
      audience={audience}
      {...(audience === 'client' ? { clientName: title } : {})}
      {...(conversation.partyKind === 'contact' && conversation.partyId
        ? { clientContactId: conversation.partyId }
        : {})}
      {...(audience === 'client'
        ? {
            readOnly: {
              reason: job
                ? 'Texts to a client are sent from the job, so the office knows which one they are about.'
                : 'Texts to a client are sent from the job, and none of your jobs is with this client. Ask dispatch if you need to write to them.',
              ...(job
                ? {
                    actionLabel: 'Open the job to text',
                    onAction: () => router.push(`/jobs/${job}/messages`),
                  }
                : {}),
            },
          }
        : {})}
      onOpenJob={(dealId) => router.push(`/jobs/${dealId}`)}
      onBack={back}
    />
  );
}
