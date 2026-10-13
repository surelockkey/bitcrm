import { ForbiddenException, Injectable, Optional } from '@nestjs/common';
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
import { TechScopeService } from '../../tech-scope/tech-scope.service';
import { jobPartiesOf, scopeDealsOf, type TechScopeParty } from '../../tech-scope/tech-scope.logic';
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

@Injectable()
export class ConversationScopeService {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly deals: DealReadService,
    @Optional() private readonly techScope?: TechScopeService,
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
   * groups they are a member of (§6, through `MEMBEROF#`).
   *
   * The jobs' parties come from the stored technician scope
   * (`TechScopeService` — one GetItem) once its gate is open, from
   * deal-service on the request until then; the group memberships are read
   * beside them. Every party is then resolved in two BatchGets (`CONVOF#`
   * pointers, then conversations) rather than two reads per party. A deal
   * service that cannot answer yields only the caller's own threads.
   */
  async assignedConversations(userId: string): Promise<Conversation[]> {
    const [jobParties, memberships] = await Promise.all([
      this.techScope ? this.techScope.jobParties(userId) : this.liveJobParties(userId),
      this.conversations.listMemberOf(userId),
    ]);

    const parties = new Map<string, { kind: ConversationPointerKind; id: string }>();
    for (const p of jobParties) parties.set(`${p.kind}:${p.id}`, p);
    parties.set(`user:${userId}`, { kind: 'user', id: userId });
    for (const m of memberships) {
      parties.set(`group:${m.conversationId}`, { kind: 'group', id: m.conversationId });
    }

    const list = [...parties.values()];
    const byParty = await this.conversations.getManyByParty(list);
    // Party order decides the order of equal timestamps, as it always has.
    const found = new Map<string, Conversation>();
    for (const p of list) {
      const c = byParty.get(`${p.kind}:${p.id}`);
      if (c && !found.has(c.id)) found.set(c.id, c);
    }

    return [...found.values()].sort((a, b) =>
      conversationActivityAt(b).localeCompare(conversationActivityAt(a)),
    );
  }

  private async liveJobParties(userId: string): Promise<TechScopeParty[]> {
    const deals = (await this.deals.listByTech(userId)) ?? [];
    return jobPartiesOf(scopeDealsOf(deals, userId));
  }
}

function partyOf(deal: DealForMessaging, kind: 'contact' | 'company'): string | undefined {
  return kind === 'contact' ? deal.contactId : deal.companyId;
}
