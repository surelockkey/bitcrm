import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { type Conversation, type JwtUser, type Message, type ResolvedPermissions } from '@bitcrm/types';
import {
  ConversationsRepository,
  StaleConversationError,
  type ConversationPatch,
} from '../../conversations/conversations.repository';
import { MessagesRepository } from '../../messages/messages.repository';
import { ConversationScopeService, type Viewer } from '../access/conversation-scope.service';
import { maskConversation, maskMessage, type MaybeMaskedConversation, type MaybeMaskedMessage } from '../access/masking';
import { UserLookupService } from '../access/user-lookup.service';
import { DomainEventsService } from '../common/domain-events.service';
import { withHttpErrors } from '../common/http-errors';
import { ConversationsService } from './conversations.service';
import { type UpdateConversationDto } from './dto/update-conversation.dto';

/** How many times a state change re-reads the conversation after a stale guard. */
const MAX_ATTEMPTS = 3;

/**
 * State changes on a conversation (design §3.5, §7.1): archive / restore,
 * flag, mark read / unread, recategorise, assign — and flagging one message.
 * Every write goes through the repository's optimistic `updatedAt` guard
 * (retried from a fresh read when another writer got in first) and lands
 * the counters move in the same transaction; afterwards
 * `conversation.updated` is published for the search index.
 */
@Injectable()
export class ConversationManagementService {
  private readonly logger = new Logger(ConversationManagementService.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly reads: ConversationsService,
    private readonly scope: ConversationScopeService,
    private readonly users: UserLookupService,
    private readonly events: DomainEventsService,
  ) {}

  /** `PATCH /conversations/:id` */
  async update(id: string, dto: UpdateConversationDto, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    if (dto.assignedUserId) await this.mustExist(dto.assignedUserId);
    const patch: ConversationPatch = {};
    if (dto.state !== undefined) patch.state = dto.state;
    if (dto.flagged !== undefined) patch.flagged = dto.flagged;
    if (dto.unread !== undefined) patch.unread = dto.unread;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.assignedUserId !== undefined) patch.assignedUserId = dto.assignedUserId;
    return this.apply(id, patch, user, perms);
  }

  /**
   * `POST /conversations/:id/read` — the caller has seen the thread: READ#
   * marker with `lastReadMessageSk`, team `unread` cleared, unread counters
   * decremented, all in one transaction.
   */
  async markRead(id: string, lastReadMessageSk: string | undefined, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    const viewer = this.scope.viewerFor(user, perms);
    const { next } = await this.retrying(id, viewer, (current) =>
      this.conversations.markRead(current, user.id, { lastReadMessageSk }),
    );
    this.events.conversationUpdated(id);
    return maskConversation(next, viewer.seesNumbers);
  }

  archive(id: string, user: JwtUser, perms?: ResolvedPermissions) {
    return this.apply(id, { state: 'archived' }, user, perms);
  }

  unarchive(id: string, user: JwtUser, perms?: ResolvedPermissions) {
    return this.apply(id, { state: 'open' }, user, perms);
  }

  flag(id: string, user: JwtUser, perms?: ResolvedPermissions) {
    return this.apply(id, { flagged: true }, user, perms);
  }

  unflag(id: string, user: JwtUser, perms?: ResolvedPermissions) {
    return this.apply(id, { flagged: false }, user, perms);
  }

  /** `POST /conversations/:id/assign { userId }` — the user must exist in user-service. */
  async assign(id: string, userId: string, user: JwtUser, perms?: ResolvedPermissions) {
    await this.mustExist(userId);
    return this.apply(id, { assignedUserId: userId }, user, perms);
  }

  unassign(id: string, user: JwtUser, perms?: ResolvedPermissions) {
    return this.apply(id, { assignedUserId: null }, user, perms);
  }

  /**
   * `PATCH /conversations/:id/messages/:messageId { createdAt, flagged }` —
   * the message moves in or out of `FLAG#message#<YYYY>`. The conversation
   * itself does not change, so nothing is published for search.
   */
  async setMessageFlag(
    conversationId: string,
    messageId: string,
    createdAt: string,
    flagged: boolean,
    user: JwtUser,
    perms?: ResolvedPermissions,
  ): Promise<MaybeMaskedMessage> {
    const viewer = this.scope.viewerFor(user, perms);
    await this.reads.load(conversationId, viewer.scope);
    const key = { conversationId, createdAt, messageId };
    const message = await this.messages.get(key);
    if (!message) throw new NotFoundException('Message not found');

    const at = new Date().toISOString();
    await this.messages.setFlagged(key, flagged, user.id, at);
    const next: Message = flagged
      ? { ...message, flagged: true, flaggedAt: at, flaggedBy: user.id, updatedAt: at }
      : { ...message, flagged: false, flaggedAt: undefined, flaggedBy: undefined, updatedAt: at };
    return maskMessage(next, viewer.seesNumbers);
  }

  // -------------------------------------------------------------- internals

  /** Load (404 / 403), apply the patch under the stale guard, publish, mask. */
  private async apply(id: string, patch: ConversationPatch, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    const viewer = this.scope.viewerFor(user, perms);
    const { current, next } = await this.retrying(id, viewer, (c) =>
      this.conversations.update(c, patch, { actorId: user.id }),
    );
    // The repository hands `current` back untouched when the patch changed
    // nothing — no write, nothing to reindex.
    if (next !== current) this.events.conversationUpdated(id);
    return maskConversation(next, viewer.seesNumbers);
  }

  /**
   * Read → write, re-reading when the optimistic guard trips (another tab
   * archived or a webhook appended in between). The scope check runs on
   * every read, so a thread that left the caller's scope mid-flight is
   * refused rather than written.
   */
  private async retrying(
    id: string,
    viewer: Viewer,
    write: (current: Conversation) => Promise<Conversation>,
  ): Promise<{ current: Conversation; next: Conversation }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const current = await this.reads.load(id, viewer.scope);
      try {
        return { current, next: await write(current) };
      } catch (err) {
        if (!(err instanceof StaleConversationError)) throw err;
        lastError = err;
        this.logger.log(`Conversation ${id} changed underneath attempt ${attempt}; re-reading`);
      }
    }
    return withHttpErrors(() => Promise.reject(lastError));
  }

  private async mustExist(userId: string): Promise<void> {
    const found = await this.users.find(userId);
    if (!found) throw new NotFoundException(`User ${userId} not found`);
  }
}
