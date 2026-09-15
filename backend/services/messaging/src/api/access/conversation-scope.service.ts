import { ForbiddenException, Injectable } from '@nestjs/common';
import { getDataScopeFilter, hasPermission } from '@bitcrm/shared';
import {
  DataScope,
  type Conversation,
  type ConversationPointerKind,
  type JwtUser,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { ConversationsRepository } from '../../conversations/conversations.repository';
import { conversationActivityAt } from '../../conversations/conversation-keys';
import { DealReadService, type DealForMessaging } from './deal-read.service';

/**
 * The data scope of the `messages` resource, resolved for one caller.
 *
 * `all` — the whole inbox (admins, dispatchers, and department managers:
 * conversations carry no department, so `department` widens to `all` here
 * the way it does in search's authz).
 * `assigned_only` — a technician: conversations of the jobs they are on
 * (the job's contact / company thread) and conversations where they are the
 * party (their own team thread).
 */
export type MessagingScope = { scope: 'all' } | { scope: 'assigned_only'; userId: string };

/** Everything a request handler needs to know about who is asking. */
export interface Viewer {
  user: JwtUser;
  scope: MessagingScope;
  /** `contacts.view_numbers` — false masks the party's phone numbers. */
  seesNumbers: boolean;
}

/** Party-lookups fan out in chunks so a tech with many jobs does not open 200 reads at once. */
const PARTY_LOOKUP_CHUNK = 25;

@Injectable()
export class ConversationScopeService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly deals: DealReadService,
  ) {}

  viewerFor(user: JwtUser, perms: ResolvedPermissions | undefined): Viewer {
    return {
      user,
      scope: this.scopeFor(user, perms),
      seesNumbers: hasPermission(perms, 'contacts', 'view_numbers'),
    };
  }

  /** `getDataScopeFilter` is the canonical reading; an unresolved caller is scoped down. */
  scopeFor(user: JwtUser, perms: ResolvedPermissions | undefined): MessagingScope {
    if (!perms) return { scope: 'assigned_only', userId: user.id };
    const filter = getDataScopeFilter(user, 'messages', perms);
    return filter.scope === DataScope.ASSIGNED_ONLY
      ? { scope: 'assigned_only', userId: user.id }
      : { scope: 'all' };
  }

  /**
   * May the caller read this conversation? Under `assigned_only`, yes when
   * they are the party, a member of the group (§6), when the last job on the
   * thread has them on its roster, or when any of their current jobs is with
   * the same party. Every deal lookup that fails counts as "no".
   */
  async canAccess(c: Conversation, scope: MessagingScope): Promise<boolean> {
    if (scope.scope === 'all') return true;
    const { userId } = scope;

    if (c.partyKind === 'user' && c.partyId === userId) return true;
    if (c.kind === 'group') return (c.memberIds ?? []).includes(userId);

    if (c.lastDealId) {
      const deal = await this.deals.find(c.lastDealId);
      if (deal?.assignedTechIds.includes(userId)) return true;
    }

    if ((c.partyKind === 'contact' || c.partyKind === 'company') && c.partyId) {
      const deals = (await this.deals.listByTech(userId)) ?? [];
      return deals.some((d) => partyOf(d, c.partyKind === 'contact' ? 'contact' : 'company') === c.partyId);
    }
    return false;
  }

  /** May the caller read a job's messages? `all`, or on the roster. */
  async canAccessDeal(dealId: string, scope: MessagingScope): Promise<boolean> {
    if (scope.scope === 'all') return true;
    const deal = await this.deals.find(dealId);
    return !!deal?.assignedTechIds.includes(scope.userId);
  }

  async assertAccess(c: Conversation, scope: MessagingScope): Promise<void> {
    if (!(await this.canAccess(c, scope))) {
      throw new ForbiddenException('Conversation is outside your data scope');
    }
  }

  async assertDealAccess(dealId: string, scope: MessagingScope): Promise<void> {
    if (!(await this.canAccessDeal(dealId, scope))) {
      throw new ForbiddenException('Job is outside your data scope');
    }
  }

  /**
   * The inbox of an `assigned_only` caller, newest activity first: the
   * threads of every party on their jobs, their own team thread and the
   * groups they are a member of (§6, through `MEMBEROF#`). Read through the
   * `CONVOF#` pointers (A8) — there is no per-technician index and a tech
   * has tens of jobs, not thousands. A deal service that cannot answer
   * yields only the caller's own threads.
   */
  async assignedConversations(userId: string): Promise<Conversation[]> {
    const deals = (await this.deals.listByTech(userId)) ?? [];
    const parties = new Map<string, { kind: ConversationPointerKind; id: string }>();
    for (const deal of deals) {
      if (!deal.assignedTechIds.includes(userId)) continue;
      if (deal.contactId) parties.set(`contact:${deal.contactId}`, { kind: 'contact', id: deal.contactId });
      if (deal.companyId) parties.set(`company:${deal.companyId}`, { kind: 'company', id: deal.companyId });
    }
    parties.set(`user:${userId}`, { kind: 'user', id: userId });
    for (const m of await this.conversations.listMemberOf(userId)) {
      parties.set(`group:${m.conversationId}`, { kind: 'group', id: m.conversationId });
    }

    const found = new Map<string, Conversation>();
    const list = [...parties.values()];
    for (let i = 0; i < list.length; i += PARTY_LOOKUP_CHUNK) {
      const chunk = list.slice(i, i + PARTY_LOOKUP_CHUNK);
      const results = await Promise.all(chunk.map((p) => this.conversations.getByParty(p.kind, p.id)));
      for (const c of results) if (c) found.set(c.id, c);
    }

    return [...found.values()].sort((a, b) =>
      conversationActivityAt(b).localeCompare(conversationActivityAt(a)),
    );
  }
}

function partyOf(deal: DealForMessaging, kind: 'contact' | 'company'): string | undefined {
  return kind === 'contact' ? deal.contactId : deal.companyId;
}
