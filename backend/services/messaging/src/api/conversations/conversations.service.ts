import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CONVERSATION_POINTER_KINDS,
  type Conversation,
  type ConversationKind,
  type ConversationPointerKind,
  type ConversationReadMarker,
  type JwtUser,
  type OptOut,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { InvalidCursorError, decodeCursor, encodeCursor } from '../../common/cursor';
import { countsAsUnread } from '../../conversations/conversation-keys';
import { ConversationsRepository } from '../../conversations/conversations.repository';
import { OptOutsRepository } from '../../opt-outs/opt-outs.repository';
import { ConversationScopeService, type MessagingScope, type Viewer } from '../access/conversation-scope.service';
import { DealReadService } from '../access/deal-read.service';
import {
  looksLikePhone,
  maskConversation,
  maskConversations,
  type MaybeMaskedConversation,
} from '../access/masking';
import { withHttpErrors } from '../common/http-errors';
import { type InboxView } from './dto/list-conversations-query.dto';
import { type TextLookupPartyKind } from './dto/lookup-query.dto';

export interface ListConversationsInput {
  view: InboxView;
  kind?: ConversationKind;
  categoryId?: string;
  limit: number;
  cursor?: string;
}

export interface ConversationPage {
  items: MaybeMaskedConversation[];
  nextCursor?: string;
}

/** `GET /conversations/:id` — the thread plus the caller's own read marker. */
export type ConversationDetail = MaybeMaskedConversation & { readMarker?: ConversationReadMarker };

/** What the "Text" button on a contact card / missed call needs. */
export interface TextLookupResult {
  conversation: MaybeMaskedConversation | null;
  /** The address a new message would go to (the given one, else the party's first phone). */
  address?: string;
  addressMasked?: true;
  /** SMS opt-out row for that address, when one exists. */
  optOut: OptOut | null;
  /** There is an address and it is not opted out. */
  canText: boolean;
}

/** `view=mine` walks the open inbox in pages of this size, at most this many per request. */
const MINE_WALK_PAGE = 100;
const MINE_WALK_MAX_PAGES = 10;

/**
 * Read side of the inbox (design §3.3 A1–A5, A8, A9; §7.1). Scope and
 * masking are applied here, once, for every route: a caller under
 * `assigned_only` never sees a thread outside their jobs, and a caller
 * without `contacts.view_numbers` never sees a client's digits.
 */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly scope: ConversationScopeService,
    private readonly deals: DealReadService,
  ) {}

  /**
   * The inbox. Scope `all` reads the indexed views straight from the
   * repository (cursor passes through untouched); `mine` is a bounded walk
   * over the open inbox filtered on `assignedUserId`; `assigned_only`
   * callers get their jobs' threads paged in memory (offset cursor).
   */
  async list(input: ListConversationsInput, user: JwtUser, perms?: ResolvedPermissions): Promise<ConversationPage> {
    const viewer = this.scope.viewerFor(user, perms);
    const page = await withHttpErrors(() =>
      viewer.scope.scope === 'all'
        ? input.view === 'mine'
          ? this.listMine(input, user.id)
          : this.conversations.listInbox(
              { view: input.view, kind: input.kind, categoryId: input.categoryId },
              { limit: input.limit, cursor: input.cursor },
            )
        : this.listScoped(input, viewer),
    );
    return { items: maskConversations(page.items, viewer.seesNumbers), nextCursor: page.nextCursor };
  }

  async get(id: string, user: JwtUser, perms?: ResolvedPermissions): Promise<ConversationDetail> {
    const viewer = this.scope.viewerFor(user, perms);
    const conversation = await this.load(id, viewer.scope);
    const readMarker = await this.conversations.getReadMarker(id, user.id);
    return { ...maskConversation(conversation, viewer.seesNumbers), readMarker: readMarker ?? undefined };
  }

  /** A8 — the thread of a contact, company, employee or group; 404 when none exists yet. */
  async getByParty(kind: string, id: string, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    if (!(CONVERSATION_POINTER_KINDS as readonly string[]).includes(kind)) {
      throw new BadRequestException(`kind must be one of ${CONVERSATION_POINTER_KINDS.join(', ')}`);
    }
    const viewer = this.scope.viewerFor(user, perms);
    const conversation = await this.conversations.getByParty(kind as ConversationPointerKind, id);
    if (!conversation) throw new NotFoundException('No conversation for this party');
    await this.scope.assertAccess(conversation, viewer.scope);
    return maskConversation(conversation, viewer.seesNumbers);
  }

  /** A9 — the thread an E.164 number or email routes to. */
  async getByAddress(address: string, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    const viewer = this.scope.viewerFor(user, perms);
    const pointer = await this.conversations.getByAddress(normaliseAddress(address));
    const conversation = pointer ? await this.conversations.get(pointer.conversationId) : null;
    if (!conversation) throw new NotFoundException('No conversation for this address');
    await this.scope.assertAccess(conversation, viewer.scope);
    return maskConversation(conversation, viewer.seesNumbers);
  }

  /** The job's client thread: deal → contact (else company) → `CONVOF#`. */
  async getByJob(dealId: string, user: JwtUser, perms?: ResolvedPermissions): Promise<MaybeMaskedConversation> {
    const viewer = this.scope.viewerFor(user, perms);
    await this.scope.assertDealAccess(dealId, viewer.scope);
    const deal = await this.deals.find(dealId);
    if (!deal) throw new NotFoundException('Job not found');

    const conversation =
      (deal.contactId ? await this.conversations.getByParty('contact', deal.contactId) : null) ??
      (deal.companyId ? await this.conversations.getByParty('company', deal.companyId) : null);
    if (!conversation) throw new NotFoundException('No conversation for this job');
    return maskConversation(conversation, viewer.seesNumbers);
  }

  /**
   * Contact-level "Text" lookup: the existing thread (if any), the address a
   * message would go to, and whether that address has opted out.
   */
  async textLookup(
    query: { partyKind?: TextLookupPartyKind; partyId?: string; address?: string },
    user: JwtUser,
    perms?: ResolvedPermissions,
  ): Promise<TextLookupResult> {
    const address = query.address ? normaliseAddress(query.address) : undefined;
    if (!(query.partyKind && query.partyId) && !address) {
      throw new BadRequestException('Give partyKind + partyId or an address');
    }
    const viewer = this.scope.viewerFor(user, perms);

    let conversation: Conversation | null = null;
    if (query.partyKind && query.partyId) {
      conversation = await this.conversations.getByParty(query.partyKind, query.partyId);
    }
    if (!conversation && address) {
      const pointer = await this.conversations.getByAddress(address);
      conversation = pointer ? await this.conversations.get(pointer.conversationId) : null;
    }
    if (conversation) await this.scope.assertAccess(conversation, viewer.scope);

    const target = address ?? conversation?.addresses.phones[0];
    const optOut = target && looksLikePhone(target) ? await this.optOuts.get('sms', target) : null;
    const result: TextLookupResult = {
      conversation: conversation ? maskConversation(conversation, viewer.seesNumbers) : null,
      optOut,
      canText: !!target && optOut?.status !== 'opted_out',
    };
    if (target) {
      if (viewer.seesNumbers || !looksLikePhone(target)) result.address = target;
      else result.addressMasked = true;
    }
    return result;
  }

  /** `GET /conversations/internal/:id` — raw, for the search indexer. */
  async getInternal(id: string): Promise<Conversation> {
    const conversation = await this.conversations.get(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  /**
   * `GET /conversations/internal/all` — every thread, open then archived,
   * raw and unmasked, for the search backfill (§7.4). The cursor is the
   * repository's; a malformed one is a 400.
   */
  async listInternal(paging: { limit: number; cursor?: string }): Promise<{ items: Conversation[]; nextCursor?: string }> {
    return withHttpErrors(() => this.conversations.listAll(paging));
  }

  /** The conversation, 404 when missing, 403 when outside the caller's scope. */
  async load(id: string, scope: MessagingScope): Promise<Conversation> {
    const conversation = await this.conversations.get(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    await this.scope.assertAccess(conversation, scope);
    return conversation;
  }

  // -------------------------------------------------------------- internals

  /**
   * `view=mine` for a full-scope caller. There is no index on
   * `assignedUserId`, so this walks the open inbox (GSI1, narrowed by kind /
   * categoryId when given) in pages of 100 and keeps the matches — at most
   * 10 pages per request, then it hands back a cursor so the client can ask
   * again. The cursor `{ p, o }` is the underlying page cursor plus the
   * offset inside that page where the previous request stopped, so no match
   * is skipped or repeated. An `ASSIGNEE#` index would replace this walk.
   */
  private async listMine(
    input: ListConversationsInput,
    userId: string,
  ): Promise<{ items: Conversation[]; nextCursor?: string }> {
    const raw = decodeCursor<{ p?: unknown; o?: unknown }>(input.cursor);
    if (raw && (raw.p !== undefined && typeof raw.p !== 'string')) throw new InvalidCursorError();
    if (raw && (raw.o !== undefined && typeof raw.o !== 'number')) throw new InvalidCursorError();

    let pageCursor = raw?.p as string | undefined;
    let offset = (raw?.o as number | undefined) ?? 0;
    const items: Conversation[] = [];
    const query = { view: 'all' as const, kind: input.kind, categoryId: input.categoryId };

    for (let pages = 0; pages < MINE_WALK_MAX_PAGES; pages++) {
      const page = await this.conversations.listInbox(query, { limit: MINE_WALK_PAGE, cursor: pageCursor });
      for (let i = offset; i < page.items.length; i++) {
        const c = page.items[i];
        if (c.assignedUserId !== userId) continue;
        items.push(c);
        if (items.length === input.limit) {
          const nextCursor =
            i + 1 < page.items.length
              ? encodeCursor({ p: pageCursor, o: i + 1 })
              : page.nextCursor
                ? encodeCursor({ p: page.nextCursor, o: 0 })
                : undefined;
          return { items, nextCursor };
        }
      }
      if (!page.nextCursor) return { items };
      pageCursor = page.nextCursor;
      offset = 0;
    }
    // Walk budget spent: hand the position back rather than keep the request open.
    return { items, nextCursor: encodeCursor({ p: pageCursor, o: 0 }) };
  }

  /** `assigned_only`: the jobs' threads, filtered by tab in memory, offset cursor `{ o }`. */
  private async listScoped(
    input: ListConversationsInput,
    viewer: Viewer,
  ): Promise<{ items: Conversation[]; nextCursor?: string }> {
    const raw = decodeCursor<{ o?: unknown }>(input.cursor);
    if (raw && typeof raw.o !== 'number') throw new InvalidCursorError();
    const offset = (raw?.o as number | undefined) ?? 0;

    const all = await this.scope.assignedConversations(viewer.user.id);
    const filtered = all.filter((c) => matchesView(c, input, viewer.user.id));
    const items = filtered.slice(offset, offset + input.limit);
    const end = offset + input.limit;
    return { items, nextCursor: end < filtered.length ? encodeCursor({ o: end }) : undefined };
  }
}

/** The tab semantics of the indexed views, applied in memory. */
export function matchesView(c: Conversation, input: Pick<ListConversationsInput, 'view' | 'kind' | 'categoryId'>, userId: string): boolean {
  switch (input.view) {
    case 'archived':
      if (c.state !== 'archived') return false;
      break;
    case 'unread':
      if (!countsAsUnread(c)) return false;
      break;
    case 'flagged':
      if (!c.flagged) return false;
      break;
    case 'mine':
      if (c.state !== 'open' || c.assignedUserId !== userId) return false;
      break;
    case 'all':
    default:
      if (c.state !== 'open') return false;
  }
  if (input.kind && c.kind !== input.kind) return false;
  if (input.categoryId && c.categoryId !== input.categoryId) return false;
  return true;
}

/** Emails are stored lowercase; phones as given (E.164 from the client). */
export const normaliseAddress = (address: string) => {
  const trimmed = address.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
};
