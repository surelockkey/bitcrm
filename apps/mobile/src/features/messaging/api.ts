import * as Crypto from 'expo-crypto';
import type {
  Conversation,
  ConversationReadMarker,
  Message,
  OptOut,
  TeamChatCounters,
} from '@bitcrm/types';
import { ApiError } from '../../lib/api/errors';
import { http, type Page } from '../../lib/api/http';

/**
 * A fresh idempotency key per tap.
 *
 * Without one the server dedupes the automatic texts on
 * (rule, job, technician, 15-minute bucket) — which ignores the minutes. A
 * technician who says "15 minutes" and then, five minutes later, "45 minutes"
 * would get a 202 for the second and the client would never see it
 * (docs/ARCHITECTURE.md §1.4). So every send mints its own.
 */
export function newClientMessageId(): string {
  return Crypto.randomUUID();
}

export interface OnMyWayBody {
  dealId: string;
  /** 1…600. Omitted, the template says "on the way" without a time. */
  etaMinutes?: number;
  clientMessageId: string;
}

export interface RunningLateBody {
  dealId: string;
  /** 1…600. Required by the server for this one. */
  minutes: number;
  clientMessageId: string;
}

/**
 * "On my way" — the workspace's own wording, rendered and sent server-side, so
 * the phone never composes a customer-facing text.
 */
export const sendOnMyWay = (body: OnMyWayBody): Promise<unknown> =>
  http.post('/messaging/automations/on-my-way', body);

/** "Running late", with how many minutes. */
export const sendRunningLate = (body: RunningLateBody): Promise<unknown> =>
  http.post('/messaging/automations/late', body);

/* ------------------------------------------------- the thread with the office */

/**
 * The technician's own team thread, as `GET /messaging/team/conversations`
 * hands it over: the conversation plus **the caller's own** read state
 * (`viewerUnread`, not the office's team-wide `unread` flag) —
 * `team/team-counters.service.ts:13-21`.
 */
export type TeamThread = Conversation & {
  viewerUnread: boolean;
  viewerUnreadCount: number;
  readMarker?: ConversationReadMarker;
  phonesMasked?: true;
};

/** One line of the feed. A viewer without `contacts.view_numbers` gets numbers withheld. */
export type FeedMessage = Message & { fromMasked?: true; toMasked?: true };

/**
 * What the phone sends. `channel: 'in_app'` is the team-chat channel: stored
 * `sent` with no carrier in the way, delivered to the office over SSE
 * (send.service.ts:733-740). `clientMessageId` is the queue row's own id, so a
 * replay after a dropped connection returns the first message instead of
 * writing a second (send.controller.ts:34).
 */
export interface SendChatBody {
  clientMessageId: string;
  channel: 'in_app';
  body: string;
  /** The job the line is about; the office sees it on the message (JobIndex). */
  dealId?: string;
}

/**
 * The staff threads this caller may see. A technician's `team_chat` scope is
 * `assigned_only`, so this is exactly one row — their own thread — and a
 * dispatcher opening the app would get the whole team's, which is why the
 * caller picks their own by `partyId` rather than trusting the first row
 * (`team-conversations.service.ts:127-140`).
 */
export const listTeamThreads = (limit = 20): Promise<Page<TeamThread>> =>
  http.paginated<TeamThread>(`/messaging/team/conversations?kind=team&limit=${limit}`);

/** The caller's own badge: `{ unreadConversations, unreadByKind: { team, group } }`. */
export const getTeamChatCounters = (): Promise<TeamChatCounters> =>
  http.get<TeamChatCounters>('/messaging/team/counters');

/** The feed, newest first. `cursor` loads older. */
export const listMessages = (
  conversationId: string,
  cursor?: string,
  limit = 30,
): Promise<Page<FeedMessage>> => {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  return http.paginated<FeedMessage>(
    `/messaging/conversations/${conversationId}/messages?${q.toString()}`,
  );
};

/** Send into an existing thread. Answers 202 with the stored message. */
export const sendChatMessage = (
  conversationId: string,
  body: SendChatBody,
): Promise<FeedMessage> =>
  http.post<FeedMessage>(`/messaging/conversations/${conversationId}/messages`, body);

/**
 * Move this technician's own read marker. The team route, not the inbox one:
 * on their own thread the employee advances only their `READ#` marker and
 * leaves the office's unread flag and the inbox counters alone
 * (`team.controller.ts:90-99`).
 */
export const markThreadRead = (
  conversationId: string,
  lastReadMessageSk?: string,
): Promise<unknown> =>
  http.post(`/messaging/team/conversations/${conversationId}/read`, { lastReadMessageSk });

/**
 * Find or create the technician's thread with the office.
 *
 * Needed only for the very first line a technician ever writes: until then
 * nobody has opened a thread for them and there is no id to send to. It is
 * find-or-create (`start-conversation.service.ts:88-90`), so calling it again
 * costs one read and returns the same thread.
 */
export const openOfficeThread = (
  userId: string,
): Promise<{ conversation: TeamThread; created: boolean }> =>
  http.post<{ conversation: TeamThread; created: boolean }>('/messaging/conversations', {
    partyKind: 'user',
    partyId: userId,
  });

/* ------------------------------------------------- the thread with the client */

/**
 * SMS to clients is this account's biggest channel by a distance — 78.4% of
 * 2.26M messages, against 18.4% in-app (`WORKIZ_MOBILE_APP.md` §1.5). A
 * technician outside a door wants to say "I'm here" without handing over their
 * own number, which is what these three calls are for.
 */

/** A conversation with a client, as the inbox hands it over. */
export type ClientThread = Conversation & { phonesMasked?: true };

/** Nothing there yet is an answer, not a failure — 404 is the normal case. */
async function nullOn404<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/**
 * The client thread of a job.
 *
 * Anchored on the **job**, not on the contact: the server resolves the job's
 * own client and answers with their thread, and under `assigned_only` it first
 * checks the caller is on that job (`conversations.controller.ts:97-112`). A
 * lookup by contact id would be one guess further from the thing on screen,
 * and the guess it could get wrong is which client.
 *
 * 404 until somebody has written to them — a job booked this morning has no
 * thread, and that is the empty state rather than an error.
 */
export const getJobClientThread = (dealId: string): Promise<ClientThread | null> =>
  nullOn404(http.get<ClientThread>(`/messaging/conversations/by-job/${dealId}`));

/**
 * What the "Text" button needs before anything is typed: can this client be
 * texted at all, and have they replied STOP.
 */
export interface ClientTextLookup {
  conversation: ClientThread | null;
  /** The number a text would go to; withheld without `contacts.view_numbers`. */
  address?: string;
  addressMasked?: true;
  optOut: OptOut | null;
  canText: boolean;
}

export const lookupClientText = (contactId: string): Promise<ClientTextLookup> => {
  const q = new URLSearchParams({ partyKind: 'contact', partyId: contactId });
  return http.get<ClientTextLookup>(
    `/messaging/conversations/text-lookup?${q.toString()}`,
  );
};

export interface SendClientTextBody {
  /** The outbox row's id. A replay returns the first message, never a second. */
  clientMessageId: string;
  contactId: string;
  /** The job the text is about; the office sees it on the message (JobIndex). */
  dealId: string;
  body: string;
}

/**
 * Text the client.
 *
 * `POST /messages` rather than `POST /conversations/:id/messages`, and
 * deliberately: it finds **or opens** the client's thread in the same request
 * (`send.service.ts:207-223`), so the first text a technician ever sends to a
 * client works from a phone that has never seen that thread — which is the
 * case underground, where there is no id to have looked up.
 *
 * `dealId` is not decoration. Under the `assigned_only` scope a technician
 * carries, the server authorises the send against `dto.dealId`
 * (`send.service.ts:942-950`): without it the check falls back to whatever job
 * the thread last touched, and a text about today's job would be judged by
 * last year's.
 */
export const sendClientText = (body: SendClientTextBody): Promise<FeedMessage> =>
  http.post<FeedMessage>('/messaging/messages', { ...body, channel: 'sms' });
