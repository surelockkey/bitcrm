import {
  type Conversation,
  type InboxCounters,
  type Message,
  type OptOutChannel,
  type OptOutStatus,
} from '@bitcrm/types';

/** Redis pub/sub channel every messaging instance publishes to and reads from. */
export const REALTIME_CHANNEL = 'messaging:events';

/**
 * What the web's `MessagingStreamProvider` receives over
 * `GET /api/messaging/events` (design §7.6). One global stream per tab; the
 * server filters each event by the viewer's data scope and masks numbers
 * before writing it, so a frame is always safe to patch straight into the
 * React Query cache.
 *
 *   conversation.upserted  a conversation row changed (new message rolled
 *                          it forward, archive, flag, read, assign …) — the
 *                          full row, replace it in the list / detail cache
 *   message.upserted       a message was appended or its status changed —
 *                          the full message plus, when known, the
 *                          conversation as it is after the change
 *   counters.changed       the badge numbers; for an `assigned_only` viewer
 *                          they are recounted over their own threads
 *   opt_out.changed        an address opted out / back in (banner in the
 *                          composer); `address` is masked like any number
 */
export interface ConversationUpsertedEvent {
  type: 'conversation.upserted';
  at: string;
  conversation: Conversation;
}

export interface MessageUpsertedEvent {
  type: 'message.upserted';
  at: string;
  message: Message;
  /** The conversation after the change; when absent the stream looks it up for scoping. */
  conversation?: Conversation;
  /**
   * Team / group delivery (design §6): the member ids the line is for — the
   * group roster or the employee, minus the author. The web badges from it;
   * scoping still happens per viewer on delivery.
   */
  recipients?: string[];
  /** User ids @-mentioned in the line (`Message.mentions`, repeated here for the badge). */
  mentions?: string[];
}

export interface CountersChangedEvent {
  type: 'counters.changed';
  at: string;
  counters: InboxCounters;
}

export interface OptOutChangedEvent {
  type: 'opt_out.changed';
  at: string;
  channel: OptOutChannel;
  address?: string;
  status: OptOutStatus;
  /** The thread the address routes to, so a masked viewer can still place the banner. */
  conversationId?: string;
}

export type MessagingRealtimeEvent =
  | ConversationUpsertedEvent
  | MessageUpsertedEvent
  | CountersChangedEvent
  | OptOutChangedEvent;

export type MessagingRealtimeEventType = MessagingRealtimeEvent['type'];

export const REALTIME_EVENT_TYPES: readonly MessagingRealtimeEventType[] = [
  'conversation.upserted',
  'message.upserted',
  'counters.changed',
  'opt_out.changed',
];

/** Cheap shape check on what came off the wire — a malformed frame is dropped, not thrown. */
export function isRealtimeEvent(value: unknown): value is MessagingRealtimeEvent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.type === 'string' && (REALTIME_EVENT_TYPES as readonly string[]).includes(v.type);
}
