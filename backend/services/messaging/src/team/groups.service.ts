import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CONVERSATION_GROUP_MAX_MEMBERS,
  type Conversation,
  type ConversationMember,
  type ConversationParticipant,
  type JwtUser,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { ConversationsRepository, StaleConversationError } from '../conversations/conversations.repository';
import { UserLookupService } from '../api/access/user-lookup.service';
import { DomainEventsService } from '../api/common/domain-events.service';
import { withHttpErrors } from '../api/common/http-errors';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { type CreateGroupDto, type UpdateGroupDto } from './dto/team.dto';
import { TeamAccessService, type TeamViewer } from './team-access.service';
import { TeamConversationsService, mergeMarkers, type TeamPage } from './team-conversations.service';
import { TeamCountersService, type TeamConversationView } from './team-counters.service';

/** `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id`: the header with the viewer's read state and the roster. */
export type GroupDetail = TeamConversationView & { members: ConversationParticipant[] };

/** How many times a membership change re-reads after a stale guard. */
const MAX_ATTEMPTS = 3;
/** User-service lookups fan out in chunks. */
const LOOKUP_CHUNK = 25;

/**
 * Group chats (design §6): a `group` conversation whose roster lives in
 * `MEMBER#` rows (copied to `memberIds` on the header for scope checks).
 * Creating and changing membership needs `team_chat.manage_groups` (the
 * guard); the creator always joins as `owner`. Members are validated
 * against user-service before anything is written. Groups are never
 * deleted — history is kept forever — archive through the inbox instead.
 */
@Injectable()
export class GroupsService {
  private readonly logger = new Logger(GroupsService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly access: TeamAccessService,
    private readonly team: TeamConversationsService,
    private readonly readState: TeamCountersService,
    private readonly users: UserLookupService,
    private readonly events: DomainEventsService,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  /** `POST /groups { name, memberIds }`. */
  async create(dto: CreateGroupDto, user: JwtUser, perms?: ResolvedPermissions): Promise<GroupDetail> {
    this.access.viewerFor(user, perms);
    const memberIds = unique([user.id, ...dto.memberIds]);
    if (memberIds.length > CONVERSATION_GROUP_MAX_MEMBERS) {
      throw new BadRequestException(`A group may have at most ${CONVERSATION_GROUP_MAX_MEMBERS} members`);
    }
    await this.mustExist(memberIds.filter((id) => id !== user.id));

    const now = new Date().toISOString();
    const id = randomUUID();
    const conversation: Conversation = {
      id,
      kind: 'group',
      partyKind: 'group',
      partyId: id,
      name: dto.name.trim(),
      addresses: { phones: [], emails: [] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    const members: ConversationMember[] = memberIds.map((userId) => ({
      conversationId: id,
      userId,
      role: userId === user.id ? 'owner' : 'member',
      joinedAt: now,
    }));
    const stored = await this.conversations.createGroup(conversation, members);
    this.logger.log(`Group "${conversation.name}" (${id}) created by ${user.id} with ${members.length} member(s)`);
    this.realtime?.conversationUpserted(stored, now);
    this.events.conversationUpdated(id);
    return { ...stored, viewerUnread: false, viewerUnreadCount: 0, members };
  }

  /** `GET /groups` — every open group for the office, the caller's own for a technician. */
  list(input: { limit: number; cursor?: string }, user: JwtUser, perms?: ResolvedPermissions): Promise<TeamPage> {
    return this.team.list({ kind: 'group', ...input }, user, perms);
  }

  /** `GET /groups/:id` — header, read state and roster. */
  async get(id: string, user: JwtUser, perms?: ResolvedPermissions): Promise<GroupDetail> {
    const viewer = this.access.viewerFor(user, perms);
    const conversation = await this.loadGroup(id, viewer);
    return this.detail(conversation, user.id);
  }

  /**
   * `PATCH /groups/:id { name?, addMemberIds?, removeMemberIds? }`. Adds
   * are validated against user-service; at least one member must remain.
   * The header and the `MEMBER#` rows change in one guarded transaction,
   * retried from a fresh read when a message landed in between.
   */
  async update(id: string, dto: UpdateGroupDto, user: JwtUser, perms?: ResolvedPermissions): Promise<GroupDetail> {
    const viewer = this.access.viewerFor(user, perms);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException('name must not be blank');
    const wantAdd = unique(dto.addMemberIds ?? []);
    const wantRemove = new Set(dto.removeMemberIds ?? []);
    for (const both of wantAdd) {
      if (wantRemove.has(both)) throw new BadRequestException(`User ${both} is in both addMemberIds and removeMemberIds`);
    }
    await this.mustExist(wantAdd);

    let current = await this.loadGroup(id, viewer);
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const have = current.memberIds ?? [];
      const at = new Date().toISOString();
      const add: ConversationMember[] = wantAdd
        .filter((userId) => !have.includes(userId))
        .map((userId) => ({ conversationId: id, userId, role: 'member', joinedAt: at }));
      const remove = have.filter((userId) => wantRemove.has(userId));
      const remaining = have.length - remove.length + add.length;
      if (remaining < 1) throw new BadRequestException('A group must keep at least one member');
      if (remaining > CONVERSATION_GROUP_MAX_MEMBERS) {
        throw new BadRequestException(`A group may have at most ${CONVERSATION_GROUP_MAX_MEMBERS} members`);
      }

      try {
        const next = await this.conversations.updateMembers(
          current,
          { add, remove, name: name !== undefined && name !== current.name ? name : undefined },
          { actorId: user.id, at },
        );
        if (next !== current) {
          this.logger.log(`Group ${id} updated by ${user.id}: +${add.length} -${remove.length}${name ? ' renamed' : ''}`);
          this.realtime?.conversationUpserted(next, at);
          // Whoever joined or left sees a different list and badge (§6).
          this.realtime?.teamCountersInvalidated(id, [...add.map((m) => m.userId), ...remove], at);
          this.events.conversationUpdated(id);
        }
        return this.detail(next, user.id);
      } catch (err) {
        if (!(err instanceof StaleConversationError)) throw err;
        lastError = err;
        this.logger.log(`Group ${id} changed underneath update attempt ${attempt}; re-reading`);
        current = await this.loadGroup(id, viewer);
      }
    }
    return withHttpErrors(() => Promise.reject(lastError));
  }

  // -------------------------------------------------------------- internals

  private async loadGroup(id: string, viewer: TeamViewer): Promise<Conversation> {
    const conversation = await this.team.load(id, viewer);
    if (conversation.kind !== 'group') throw new NotFoundException('Not a group conversation');
    return conversation;
  }

  private async detail(conversation: Conversation, userId: string): Promise<GroupDetail> {
    const [members, readers, member] = await Promise.all([
      this.conversations.listMembers(conversation.id),
      this.conversations.listReadMarkers(conversation.id),
      this.conversations.getMember(conversation.id, userId),
    ]);
    const state = await this.readState.readStateFor(conversation, userId, member?.joinedAt);
    return { ...conversation, ...state, members: mergeMarkers(members, readers) };
  }

  /** Every id must be a user; unknown ones are named in the 400 (503 when user-service cannot answer). */
  private async mustExist(userIds: string[]): Promise<void> {
    const unknown: string[] = [];
    for (let i = 0; i < userIds.length; i += LOOKUP_CHUNK) {
      const chunk = userIds.slice(i, i + LOOKUP_CHUNK);
      const found = await Promise.all(chunk.map((id) => this.users.find(id)));
      chunk.forEach((id, j) => {
        if (!found[j]) unknown.push(id);
      });
    }
    if (unknown.length) throw new BadRequestException(`Unknown users: ${unknown.join(', ')}`);
  }
}

const unique = (ids: string[]): string[] => [...new Set(ids)];
