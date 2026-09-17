import * as Crypto from 'expo-crypto';
import type {
  Conversation,
  ConversationReadMarker,
  Message,
  TeamChatCounters,
} from '@bitcrm/types';
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
