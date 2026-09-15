import { Injectable } from '@nestjs/common';
import {
  type Conversation,
  type ConversationMember,
  type ConversationReadMarker,
  type TeamChatCounters,
} from '@bitcrm/types';
import { MESSAGE_SK_PREFIX, messageSk } from '../common/constants/dynamo.constants';
import { conversationActivityAt } from '../conversations/conversation-keys';
import { ConversationsRepository, UNREAD_COUNT_CAP } from '../conversations/conversations.repository';

/** What one viewer sees on a staff thread: read or not, and how far behind. */
export interface TeamReadState {
  viewerUnread: boolean;
  /** Messages after the viewer's marker, capped at `UNREAD_COUNT_CAP`; 0 when read. */
  viewerUnreadCount: number;
  readMarker?: ConversationReadMarker;
}

export type TeamConversationView = Conversation & TeamReadState;

/** Lookups fan out in chunks so a member of many groups does not open every read at once. */
const LOOKUP_CHUNK = 25;

/**
 * Whether `c` has something `userId` has not read, from the header and the
 * user's `READ#` marker alone (design §6: unread per participant):
 *
 *   - nothing on the thread yet → read;
 *   - the party's own last message (a technician's SMS or in-app line on
 *     their thread is `inbound`) → read for the party;
 *   - a marker with a message key → read iff it is at or past the last message;
 *   - a marker with only a time → read iff it is not older than the last message;
 *   - no marker → unread, unless the member joined after the last message.
 */
export function isUnreadFor(
  c: Conversation,
  userId: string,
  marker: ConversationReadMarker | null | undefined,
  since?: string,
): boolean {
  if (!c.lastMessageAt) return false;
  if (c.kind === 'team' && c.partyKind === 'user' && c.partyId === userId && c.lastDirection === 'inbound') {
    return false;
  }
  if (marker?.lastReadMessageSk) {
    return c.lastMessageId
      ? marker.lastReadMessageSk < messageSk(c.lastMessageAt, c.lastMessageId)
      : marker.lastReadMessageSk < `${MESSAGE_SK_PREFIX}${c.lastMessageAt}`;
  }
  if (marker?.lastReadAt) return marker.lastReadAt < c.lastMessageAt;
  if (since) return since < c.lastMessageAt;
  return true;
}

/** The sort key `countMessagesAfter` starts from for this marker (or join time). */
export function unreadFromSk(marker: ConversationReadMarker | null | undefined, since?: string): string | undefined {
  if (marker?.lastReadMessageSk) return marker.lastReadMessageSk;
  if (marker?.lastReadAt) return `${MESSAGE_SK_PREFIX}${marker.lastReadAt}`;
  if (since) return `${MESSAGE_SK_PREFIX}${since}`;
  return undefined;
}

/**
 * Per-member read state of staff threads (design §6): the badge for one
 * user, and the `viewerUnread` / `viewerUnreadCount` decoration of a list.
 * Reads only `READ#` markers and, for threads that are unread, one capped
 * COUNT query — the team-wide `unread` flag and `INBOX#COUNTERS` are the
 * office's and are left alone here.
 */
@Injectable()
export class TeamCountersService {
  constructor(private readonly conversations: ConversationsRepository) {}

  /** The user's own thread plus every group they are in, newest activity first, with their membership rows. */
  async conversationsOf(userId: string): Promise<{ conversations: Conversation[]; membership: Map<string, ConversationMember> }> {
    const membership = new Map<string, ConversationMember>();
    for (const m of await this.conversations.listMemberOf(userId)) membership.set(m.conversationId, m);

    const found: Conversation[] = [];
    const own = await this.conversations.getByParty('user', userId);
    if (own) found.push(own);
    const ids = [...membership.keys()];
    for (let i = 0; i < ids.length; i += LOOKUP_CHUNK) {
      const chunk = ids.slice(i, i + LOOKUP_CHUNK);
      const results = await Promise.all(chunk.map((id) => this.conversations.get(id)));
      for (const c of results) if (c && c.state === 'open') found.push(c);
    }
    found.sort((a, b) => conversationActivityAt(b).localeCompare(conversationActivityAt(a)));
    return { conversations: found, membership };
  }

  /** `GET /team/counters` and the `team_counters.changed` event for one member. */
  async forUser(userId: string): Promise<TeamChatCounters> {
    const { conversations, membership } = await this.conversationsOf(userId);
    const counters: TeamChatCounters = { unreadConversations: 0, unreadByKind: {} };
    for (const c of conversations) {
      const marker = await this.conversations.getReadMarker(c.id, userId);
      if (!isUnreadFor(c, userId, marker, membership.get(c.id)?.joinedAt)) continue;
      counters.unreadConversations += 1;
      const kind = c.kind === 'group' ? 'group' : 'team';
      counters.unreadByKind[kind] = (counters.unreadByKind[kind] ?? 0) + 1;
    }
    return counters;
  }

  /** One thread's read state for `userId`; the count query runs only when the thread is unread. */
  async readStateFor(c: Conversation, userId: string, since?: string): Promise<TeamReadState> {
    const marker = await this.conversations.getReadMarker(c.id, userId);
    if (!isUnreadFor(c, userId, marker, since)) {
      return { viewerUnread: false, viewerUnreadCount: 0, readMarker: marker ?? undefined };
    }
    const count = await this.conversations.countMessagesAfter(c.id, unreadFromSk(marker, since), UNREAD_COUNT_CAP);
    return { viewerUnread: true, viewerUnreadCount: Math.max(count, 1), readMarker: marker ?? undefined };
  }

  /** The list decoration: every conversation with the viewer's read state, in the given order. */
  async decorate(
    list: Conversation[],
    userId: string,
    membership?: Map<string, ConversationMember>,
  ): Promise<TeamConversationView[]> {
    const out: TeamConversationView[] = [];
    for (let i = 0; i < list.length; i += LOOKUP_CHUNK) {
      const chunk = list.slice(i, i + LOOKUP_CHUNK);
      const states = await Promise.all(chunk.map((c) => this.readStateFor(c, userId, membership?.get(c.id)?.joinedAt)));
      chunk.forEach((c, j) => out.push({ ...c, ...states[j] }));
    }
    return out;
  }
}
