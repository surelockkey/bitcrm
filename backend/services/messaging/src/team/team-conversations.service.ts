import { ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  type Conversation,
  type ConversationParticipant,
  type ConversationReadMarker,
  type JwtUser,
  type ResolvedPermissions,
  type TeamChatCounters,
} from '@bitcrm/types';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../common/cursor';
import { countersDelta } from '../conversations/conversation-keys';
import { ConversationsRepository, StaleConversationError } from '../conversations/conversations.repository';
import { InboxCountersRepository } from '../counters/inbox-counters.repository';
import { UserLookupService } from '../api/access/user-lookup.service';
import { DomainEventsService } from '../api/common/domain-events.service';
import { withHttpErrors } from '../api/common/http-errors';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { TeamAccessService, type TeamViewer } from './team-access.service';
import { TeamCountersService, type TeamConversationView, type TeamReadState } from './team-counters.service';
import { type TeamListKind } from './dto/team.dto';

export interface TeamListInput {
  kind: TeamListKind;
  limit: number;
  cursor?: string;
}

export interface TeamPage {
  items: TeamConversationView[];
  nextCursor?: string;
}

/** `GET /team/conversations/:id`: the thread, the viewer's read state and, for a group, the roster. */
export type TeamConversationDetail = TeamConversationView & { members?: ConversationParticipant[] };

/** `GET /team/conversations/:id/participants`. */
export interface TeamParticipants {
  /** Group members (with their read markers); for a 1:1 thread, the employee. */
  members: ConversationParticipant[];
  /** Everyone who has a `READ#` marker — for a 1:1 thread, that is the office side. */
  readers: ConversationReadMarker[];
}

/** How many times the office's mark-read re-reads after a stale guard. */
const MAX_ATTEMPTS = 3;

/**
 * Employee threads (design §6): find-or-create the 1:1 thread of a user
 * (`CONVOF#user#<id>` — the same key the inbound SMS webhook opens it
 * under, so a text from the technician's personal phone and an in-app
 * line from the office land in one feed), the per-viewer list and badge,
 * and the two flavours of "read": the office clears the team-wide flag,
 * a member only moves their own `READ#` marker.
 */
@Injectable()
export class TeamConversationsService {
  private readonly logger = new Logger(TeamConversationsService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly access: TeamAccessService,
    private readonly readState: TeamCountersService,
    private readonly users: UserLookupService,
    private readonly events: DomainEventsService,
    @Optional() private readonly inboxCounters?: InboxCountersRepository,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  /**
   * `POST /conversations { partyKind: 'user', partyId }`. Needs
   * `team_chat.send`; a technician may only open their own thread. The
   * user's personal phone (user-service) is recorded as the thread's
   * address and pointed at it (`ADDR#`) so their next SMS routes here
   * without a directory call.
   */
  async findOrCreateForUser(
    partyId: string,
    user: JwtUser,
    perms?: ResolvedPermissions,
  ): Promise<{ conversation: Conversation; created: boolean }> {
    const viewer = this.access.viewerFor(user, perms);
    if (!viewer.maySend) throw new ForbiddenException('Missing permission: team_chat.send');
    if (viewer.scope.scope === 'own' && partyId !== user.id) {
      throw new ForbiddenException('You can only open your own team thread');
    }

    const existing = await this.conversations.getByParty('user', partyId);
    if (existing) return { conversation: existing, created: false };

    const teammate = await this.users.find(partyId);
    if (!teammate) throw new NotFoundException(`User ${partyId} not found`);

    const now = new Date().toISOString();
    const phones = teammate.phone ? [teammate.phone] : [];
    const { conversation, created } = await this.conversations.findOrCreate({
      conversation: {
        id: randomUUID(),
        kind: 'team',
        partyKind: 'user',
        partyId,
        addresses: { phones, emails: [] },
        state: 'open',
        unread: false,
        unreadCount: 0,
        flagged: false,
        createdAt: now,
        updatedAt: now,
      },
      pointer: { kind: 'user', id: partyId },
      addresses: phones.map((address) => ({ address, source: 'crm' as const })),
    });
    if (created) {
      this.logger.log(`Opened team thread ${conversation.id} for user ${partyId} (by ${user.id})`);
      this.realtime?.conversationUpserted(conversation, now);
      this.events.conversationUpdated(conversation.id);
    }
    return { conversation, created };
  }

  /**
   * `GET /team/conversations?kind=`. The office reads the indexed category
   * (`CAT#team#<YYYY>` / `CAT#group#<YYYY>`, cursor passed through); a
   * technician gets their own thread or their groups, paged in memory.
   * Every row carries the viewer's own read state.
   */
  async list(input: TeamListInput, user: JwtUser, perms?: ResolvedPermissions): Promise<TeamPage> {
    const viewer = this.access.viewerFor(user, perms);
    const { conversations, membership } = await this.conversationsFor(viewer);
    const page = await withHttpErrors(() =>
      viewer.scope.scope === 'all'
        ? this.conversations.listInbox({ view: 'all', kind: input.kind }, { limit: input.limit, cursor: input.cursor })
        : this.pageInMemory(conversations.filter((c) => c.kind === input.kind), input),
    );
    return {
      items: await this.readState.decorate(page.items, user.id, membership),
      nextCursor: page.nextCursor,
    };
  }

  /** `GET /team/conversations/:id` — 404 for a client thread, 403 outside the scope. */
  async get(id: string, user: JwtUser, perms?: ResolvedPermissions): Promise<TeamConversationDetail> {
    const viewer = this.access.viewerFor(user, perms);
    const conversation = await this.load(id, viewer);
    const member = conversation.kind === 'group' ? await this.conversations.getMember(id, user.id) : null;
    const state = await this.readState.readStateFor(conversation, user.id, member?.joinedAt);
    const detail: TeamConversationDetail = { ...conversation, ...state };
    if (conversation.kind === 'group') detail.members = await this.participants(conversation);
    return detail;
  }

  /** `GET /team/conversations/:id/participants`. */
  async getParticipants(id: string, user: JwtUser, perms?: ResolvedPermissions): Promise<TeamParticipants> {
    const viewer = this.access.viewerFor(user, perms);
    const conversation = await this.load(id, viewer);
    const readers = await this.conversations.listReadMarkers(id);
    if (conversation.kind === 'group') {
      return { members: mergeMarkers(await this.conversations.listMembers(id), readers), readers };
    }
    const party: ConversationParticipant = {
      conversationId: id,
      userId: conversation.partyId ?? '',
      role: 'member',
      joinedAt: conversation.createdAt,
    };
    return { members: mergeMarkers([party], readers), readers };
  }

  /**
   * `POST /team/conversations/:id/read`. On an employee's thread the office
   * (full scope, not the party) clears the team-wide `unread` and moves the
   * inbox counters — the same transaction as the inbox's mark-read; the
   * employee themself, and every group member, only advances their own
   * `READ#` marker.
   */
  async markRead(
    id: string,
    lastReadMessageSk: string | undefined,
    user: JwtUser,
    perms?: ResolvedPermissions,
  ): Promise<TeamConversationView> {
    const viewer = this.access.viewerFor(user, perms);
    let conversation = await this.load(id, viewer);
    const office = conversation.kind === 'team' && viewer.scope.scope === 'all' && conversation.partyId !== user.id;
    const at = new Date().toISOString();

    let marker: ConversationReadMarker;
    if (office) {
      const { current, next } = await this.officeRead(conversation, viewer, user.id, lastReadMessageSk, at);
      conversation = next;
      marker = { conversationId: id, userId: user.id, lastReadAt: at, lastReadMessageSk };
      this.events.conversationUpdated(id);
      this.pushOfficeRead(current, next);
    } else {
      marker = await this.conversations.putReadMarker(id, user.id, { lastReadMessageSk, at });
    }
    // The caller's badge changed — their other tabs recount (§6).
    this.realtime?.teamCountersInvalidated(id, [user.id], at);
    const state: TeamReadState = { viewerUnread: false, viewerUnreadCount: 0, readMarker: marker };
    return { ...conversation, ...state };
  }

  /** `GET /team/counters` — the caller's own badge. */
  counters(user: JwtUser): Promise<TeamChatCounters> {
    return this.readState.forUser(user.id);
  }

  /** The conversation, 404 when missing or not a staff thread, 403 outside the scope. */
  async load(id: string, viewer: TeamViewer): Promise<Conversation> {
    const conversation = await this.conversations.get(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.access.assertAccess(conversation, viewer.scope);
    return conversation;
  }

  // -------------------------------------------------------------- internals

  /** For an `own` viewer, their threads (and membership rows for the join dates); the office needs neither. */
  private async conversationsFor(viewer: TeamViewer) {
    if (viewer.scope.scope === 'all') {
      return { conversations: [] as Conversation[], membership: undefined };
    }
    return this.readState.conversationsOf(viewer.user.id);
  }

  private pageInMemory(all: Conversation[], input: TeamListInput): Promise<{ items: Conversation[]; nextCursor?: string }> {
    const raw = decodeCursor<{ o?: unknown }>(input.cursor);
    if (raw && typeof raw.o !== 'number') throw new InvalidCursorError();
    const offset = (raw?.o as number | undefined) ?? 0;
    const end = offset + input.limit;
    return Promise.resolve({
      items: all.slice(offset, end),
      nextCursor: end < all.length ? encodeCursor({ o: end }) : undefined,
    });
  }

  private async participants(conversation: Conversation): Promise<ConversationParticipant[]> {
    const [members, readers] = await Promise.all([
      this.conversations.listMembers(conversation.id),
      this.conversations.listReadMarkers(conversation.id),
    ]);
    return mergeMarkers(members, readers);
  }

  /** The office's read under the optimistic guard, re-reading when a message landed in between. */
  private async officeRead(
    conversation: Conversation,
    viewer: TeamViewer,
    userId: string,
    lastReadMessageSk: string | undefined,
    at: string,
  ): Promise<{ current: Conversation; next: Conversation }> {
    let current = conversation;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return { current, next: await this.conversations.markRead(current, userId, { lastReadMessageSk, at }) };
      } catch (err) {
        if (!(err instanceof StaleConversationError)) throw err;
        lastError = err;
        this.logger.log(`Conversation ${current.id} changed underneath read attempt ${attempt}; re-reading`);
        current = await this.load(current.id, viewer);
      }
    }
    return withHttpErrors(() => Promise.reject(lastError));
  }

  /** The office's inbox row changed: the row itself, and the counters when the unread badge moved. */
  private pushOfficeRead(current: Conversation, next: Conversation): void {
    if (!this.realtime) return;
    this.realtime.conversationUpserted(next);
    if (!countersDelta(current, next) || !this.inboxCounters) return;
    void this.inboxCounters
      .get()
      .then((counters) => this.realtime?.countersChanged(counters))
      .catch((err) => this.logger.warn(`counters push failed: ${err instanceof Error ? err.message : err}`));
  }
}

/** Members with their own read marker folded in (`lastReadAt`, `lastReadMessageSk`). */
export function mergeMarkers(members: ConversationParticipant[], readers: ConversationReadMarker[]): ConversationParticipant[] {
  const byUser = new Map(readers.map((r) => [r.userId, r]));
  return members.map((m) => {
    const marker = byUser.get(m.userId);
    return marker ? { ...m, lastReadAt: marker.lastReadAt, lastReadMessageSk: marker.lastReadMessageSk } : m;
  });
}
