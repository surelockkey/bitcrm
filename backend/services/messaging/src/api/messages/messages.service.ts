import { Injectable } from '@nestjs/common';
import { isSmsChannel, type JwtUser, type Message, type ResolvedPermissions } from '@bitcrm/types';
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

/** The company number a party last texted with; `at` is absent when it is older than one feed page. */
export interface LastBusinessNumber {
  businessNumber: string;
  at?: string;
}

/** How many of a thread's newest messages are searched for a company number. */
const BUSINESS_NUMBER_WALK = 50;
/** Outbound sends that never reached the party — not a number they have seen. */
const NEVER_REACHED: ReadonlySet<string> = new Set(['failed', 'undelivered', 'canceled']);

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

  /**
   * `GET /conversations/internal/:id/messages` — the feed for the search
   * indexer: no scope, no masking (the doc is filtered and masked at query
   * time in search). A missing conversation simply has an empty feed; the
   * indexer reads the conversation itself first and 404s there.
   */
  async listInternal(conversationId: string, paging: Paging): Promise<{ items: Message[]; nextCursor?: string }> {
    return withHttpErrors(() => this.messages.listByConversation(conversationId, paging));
  }

  /**
   * `GET /conversations/internal/by-party/:kind/:id/business-number` — the
   * company number this party last texted with, and when: the newest SMS on
   * their thread that carried one (`businessNumber`) and was not a failed
   * send. Telephony's masked call weighs it against the client's last call
   * to pick the number the client sees.
   *
   * One page of the feed, newest first. A thread whose company number is
   * older than that page answers the conversation's sticky
   * `lastBusinessNumber` with no `at` — known, but not when. Null when no
   * message on the thread ever carried a company number (Workiz history
   * never recorded one) or the party has no thread.
   */
  async lastBusinessNumberInternal(kind: string, id: string): Promise<LastBusinessNumber | null> {
    const conversation = await this.conversations.getByPartyInternal(kind, id);
    if (!conversation?.lastBusinessNumber) return null;
    const page = await this.messages.listByConversation(conversation.id, { limit: BUSINESS_NUMBER_WALK });
    const last = page.items.find(
      (m) => m.businessNumber && isSmsChannel(m.channel) && !NEVER_REACHED.has(m.status),
    );
    return last
      ? { businessNumber: last.businessNumber!, at: last.createdAt }
      : { businessNumber: conversation.lastBusinessNumber };
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
