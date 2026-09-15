import { Injectable } from '@nestjs/common';
import { type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { MessagesRepository } from '../../messages/messages.repository';
import { ConversationScopeService } from '../access/conversation-scope.service';
import { maskMessages, type MaybeMaskedMessage } from '../access/masking';
import { withHttpErrors } from '../common/http-errors';
import { ConversationsService } from '../conversations/conversations.service';

export interface MessagePage {
  items: MaybeMaskedMessage[];
  nextCursor?: string;
}

export interface Paging {
  limit: number;
  cursor?: string;
}

/**
 * Read side of the feeds (design §3.3 A3, A6, A7): the conversation feed,
 * the job tab and the flagged-messages tab, newest first, cursors passed
 * through from the repository. Scope is checked on the container (the
 * conversation or the job) before a single message is read.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly messages: MessagesRepository,
    private readonly conversations: ConversationsService,
    private readonly scope: ConversationScopeService,
  ) {}

  /** A6 — `GET /conversations/:id/messages`, "load older" via the cursor. */
  async listByConversation(
    conversationId: string,
    paging: Paging,
    user: JwtUser,
    perms?: ResolvedPermissions,
  ): Promise<MessagePage> {
    const viewer = this.scope.viewerFor(user, perms);
    await this.conversations.load(conversationId, viewer.scope);
    const page = await withHttpErrors(() => this.messages.listByConversation(conversationId, paging));
    return { items: maskMessages(page.items, viewer.seesNumbers), nextCursor: page.nextCursor };
  }

  /** A7 — `GET /messages/by-job/:dealId`; under `assigned_only` the caller must be on the job. */
  async listByJob(dealId: string, paging: Paging, user: JwtUser, perms?: ResolvedPermissions): Promise<MessagePage> {
    const viewer = this.scope.viewerFor(user, perms);
    await this.scope.assertDealAccess(dealId, viewer.scope);
    const page = await withHttpErrors(() => this.messages.listByJob(dealId, paging));
    return { items: maskMessages(page.items, viewer.seesNumbers), nextCursor: page.nextCursor };
  }

  /**
   * A3 — `GET /messages/flagged`. Flagged messages sit in one company-wide
   * partition per year, so an `assigned_only` caller gets only the ones
   * whose conversation is in their scope (filtered after the read).
   */
  async listFlagged(paging: Paging, user: JwtUser, perms?: ResolvedPermissions): Promise<MessagePage> {
    const viewer = this.scope.viewerFor(user, perms);
    const page = await withHttpErrors(() => this.messages.listFlagged(paging));
    let items = page.items;
    if (viewer.scope.scope !== 'all') {
      const allowed = new Set(
        (await this.scope.assignedConversations(viewer.user.id)).map((c) => c.id),
      );
      items = items.filter((m) => allowed.has(m.conversationId));
    }
    return { items: maskMessages(items, viewer.seesNumbers), nextCursor: page.nextCursor };
  }
}
