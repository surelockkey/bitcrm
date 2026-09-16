import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { CountersService } from '../../../src/api/counters/counters.service';
import { createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, createMockDeal, mockConversationsRepo, mockCountersRepo, mockDealRead, techPerms } from './api-mocks';

function make() {
  const counters = mockCountersRepo();
  const conversations = mockConversationsRepo();
  const deals = mockDealRead();
  const scope = new ConversationScopeService(conversations as never, deals as never);
  const svc = new CountersService(counters as never, scope);
  return { svc, counters, conversations, deals };
}

describe('CountersService', () => {
  it('full scope reads INBOX#COUNTERS', async () => {
    const { svc, counters, conversations } = make();
    expect(await svc.get(ADMIN, adminPerms())).toEqual({ unreadConversations: 3, flaggedConversations: 1, unreadByKind: { client: 3 } });
    expect(counters.get).toHaveBeenCalledTimes(1);
    expect(conversations.getByParty).not.toHaveBeenCalled();
  });

  it('assigned_only counts over the caller’s own threads, never the company item', async () => {
    const { svc, counters, conversations, deals } = make();
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' }), createMockDeal({ id: 'd2', contactId: 'ct2' })]);
    const threads: Record<string, ReturnType<typeof createMockConversation>> = {
      'contact:ct1': createMockConversation({ id: 'c1', unread: true, unreadCount: 4, flagged: true }),
      'contact:ct2': createMockConversation({ id: 'c2', unread: true, state: 'archived' }), // archived: not counted unread
      'user:tech-1': createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', unread: true }),
    };
    conversations.getByParty.mockImplementation(async (kind: string, id: string) => threads[`${kind}:${id}`] ?? null);

    expect(await svc.get(TECH, techPerms())).toEqual({
      unreadConversations: 2,
      flaggedConversations: 1,
      unreadByKind: { client: 1, team: 1 },
    });
    expect(counters.get).not.toHaveBeenCalled();
  });
});
