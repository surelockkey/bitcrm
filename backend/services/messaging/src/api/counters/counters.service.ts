import { Injectable } from '@nestjs/common';
import { type InboxCounters, type JwtUser, type ResolvedPermissions } from '@bitcrm/types';
import { countsAsUnread } from '../../conversations/conversation-keys';
import { InboxCountersRepository } from '../../counters/inbox-counters.repository';
import { ConversationScopeService, type MessagingScope } from '../access/conversation-scope.service';

/**
 * The badge numbers (A11). Full scope reads the single `INBOX#COUNTERS`
 * item; an `assigned_only` caller must not see the company-wide count, so
 * theirs is counted over their own threads (tens of rows, already fetched
 * for the list).
 */
@Injectable()
export class CountersService {
  constructor(
    private readonly counters: InboxCountersRepository,
    private readonly scope: ConversationScopeService,
  ) {}

  async get(user: JwtUser, perms?: ResolvedPermissions): Promise<InboxCounters> {
    return this.getForScope(this.scope.scopeFor(user, perms));
  }

  async getForScope(scope: MessagingScope): Promise<InboxCounters> {
    if (scope.scope === 'all') return this.counters.get();

    const counters: InboxCounters = { unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} };
    for (const c of await this.scope.assignedConversations(scope.userId)) {
      if (countsAsUnread(c)) {
        counters.unreadConversations += 1;
        counters.unreadByKind[c.kind] = (counters.unreadByKind[c.kind] ?? 0) + 1;
      }
      if (c.flagged) counters.flaggedConversations += 1;
    }
    return counters;
  }
}
