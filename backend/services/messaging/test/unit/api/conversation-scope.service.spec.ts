import { ForbiddenException } from '@nestjs/common';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, createMockDeal, mockConversationsRepo, mockDealRead, techPerms } from './api-mocks';

function make() {
  const repo = mockConversationsRepo();
  const deals = mockDealRead();
  const scope = new ConversationScopeService(repo as never, deals as never);
  return { scope, repo, deals };
}

describe('ConversationScopeService.scopeFor / viewerFor', () => {
  it('reads the messages data scope through getDataScopeFilter', () => {
    const { scope } = make();
    expect(scope.scopeFor(ADMIN, adminPerms())).toEqual({ scope: 'all' });
    expect(scope.scopeFor(TECH, techPerms())).toEqual({ scope: 'assigned_only', userId: 'tech-1' });
  });

  it('widens department to all (conversations carry no department) and Super Admin to all', () => {
    const { scope } = make();
    expect(scope.scopeFor(ADMIN, adminPerms({ dataScope: { messages: 'department' as never } }))).toEqual({
      scope: 'all',
    });
    expect(
      scope.scopeFor(TECH, techPerms({ roleName: 'Super Admin', isSystemRole: true, dataScope: {} })),
    ).toEqual({ scope: 'all' });
  });

  it('scopes an unresolved caller down, and an unconfigured resource down', () => {
    const { scope } = make();
    expect(scope.scopeFor(TECH, undefined)).toEqual({ scope: 'assigned_only', userId: 'tech-1' });
    expect(scope.scopeFor(TECH, techPerms({ dataScope: {} }))).toEqual({ scope: 'assigned_only', userId: 'tech-1' });
  });

  it('viewerFor carries contacts.view_numbers', () => {
    const { scope } = make();
    expect(scope.viewerFor(ADMIN, adminPerms()).seesNumbers).toBe(true);
    expect(scope.viewerFor(TECH, techPerms()).seesNumbers).toBe(false);
    expect(scope.viewerFor(TECH, undefined).seesNumbers).toBe(false);
  });
});

describe('ConversationScopeService.canAccess', () => {
  const ASSIGNED = { scope: 'assigned_only' as const, userId: 'tech-1' };

  it('full scope sees everything without a deal lookup', async () => {
    const { scope, deals } = make();
    expect(await scope.canAccess(createMockConversation(), { scope: 'all' })).toBe(true);
    expect(deals.find).not.toHaveBeenCalled();
  });

  it('the caller’s own team thread is always theirs', async () => {
    const { scope } = make();
    const mine = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'tech-1' });
    const other = createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'tech-2' });
    expect(await scope.canAccess(mine, ASSIGNED)).toBe(true);
    expect(await scope.canAccess(other, ASSIGNED)).toBe(false);
  });

  it('a thread whose last job has the caller on its roster is theirs', async () => {
    const { scope, deals } = make();
    deals.find.mockResolvedValue(createMockDeal({ id: 'd9', assignedTechIds: ['tech-1', 'tech-2'] }));
    expect(await scope.canAccess(createMockConversation({ lastDealId: 'd9' }), ASSIGNED)).toBe(true);
    expect(deals.find).toHaveBeenCalledWith('d9');
  });

  it('a client thread is theirs when any of their jobs is with that contact or company', async () => {
    const { scope, deals } = make();
    deals.listByTech.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'ct1' }),
      createMockDeal({ id: 'd2', contactId: 'ct7', companyId: 'co3' }),
    ]);
    expect(await scope.canAccess(createMockConversation({ partyKind: 'contact', partyId: 'ct1' }), ASSIGNED)).toBe(true);
    expect(await scope.canAccess(createMockConversation({ partyKind: 'company', partyId: 'co3' }), ASSIGNED)).toBe(true);
    expect(await scope.canAccess(createMockConversation({ partyKind: 'contact', partyId: 'ct2' }), ASSIGNED)).toBe(false);
  });

  it('fails closed when the deal service cannot answer', async () => {
    const { scope, deals } = make();
    deals.find.mockResolvedValue(null);
    deals.listByTech.mockResolvedValue(null);
    const c = createMockConversation({ lastDealId: 'd1', partyKind: 'contact', partyId: 'ct1' });
    expect(await scope.canAccess(c, ASSIGNED)).toBe(false);
  });

  it('a group is theirs when they are on its member list (§6)', async () => {
    const { scope, deals } = make();
    const group = createMockConversation({ kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1', 'tech-2'] });
    expect(await scope.canAccess(group, ASSIGNED)).toBe(true);
    expect(await scope.canAccess({ ...group, memberIds: ['tech-2'] }, ASSIGNED)).toBe(false);
    expect(await scope.canAccess({ ...group, memberIds: undefined }, ASSIGNED)).toBe(false);
    expect(deals.find).not.toHaveBeenCalled();
    expect(deals.listByTech).not.toHaveBeenCalled();
  });

  it('unknown-number and placeholder threads are out of scope', async () => {
    const { scope } = make();
    expect(await scope.canAccess(createMockConversation({ kind: 'unknown', partyKind: 'none', partyId: undefined }), ASSIGNED)).toBe(false);
  });

  it('assertAccess throws 403 outside the scope', async () => {
    const { scope } = make();
    await expect(scope.assertAccess(createMockConversation({ partyId: 'ct2' }), ASSIGNED)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(scope.assertAccess(createMockConversation(), { scope: 'all' })).resolves.toBeUndefined();
  });

  it('canAccessDeal / assertDealAccess check the roster', async () => {
    const { scope, deals } = make();
    deals.find.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-2'] }));
    expect(await scope.canAccessDeal('d1', ASSIGNED)).toBe(false);
    await expect(scope.assertDealAccess('d1', ASSIGNED)).rejects.toBeInstanceOf(ForbiddenException);
    deals.find.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'] }));
    expect(await scope.canAccessDeal('d1', ASSIGNED)).toBe(true);
    expect(await scope.canAccessDeal('d1', { scope: 'all' })).toBe(true);
  });
});

describe('ConversationScopeService.assignedConversations', () => {
  it('collects the jobs’ party threads plus the own team thread, deduped, newest activity first', async () => {
    const { scope, repo, deals } = make();
    deals.listByTech.mockResolvedValue([
      createMockDeal({ id: 'd1', contactId: 'ct1' }),
      createMockDeal({ id: 'd2', contactId: 'ct1' }), // same client twice → one thread
      createMockDeal({ id: 'd3', contactId: 'ct2', companyId: 'co1' }),
      createMockDeal({ id: 'd4', contactId: 'ct3', assignedTechIds: ['tech-2'] }), // not theirs
    ]);
    const threads: Record<string, ReturnType<typeof createMockConversation>> = {
      'contact:ct1': createMockConversation({ id: 'c-ct1', partyId: 'ct1', lastMessageAt: '2026-09-10T00:00:00.000Z' }),
      'contact:ct2': createMockConversation({ id: 'c-ct2', partyId: 'ct2', lastMessageAt: '2026-09-14T00:00:00.000Z' }),
      'user:tech-1': createMockConversation({
        id: 'c-me',
        kind: 'team',
        partyKind: 'user',
        partyId: 'tech-1',
        lastMessageAt: '2026-09-12T00:00:00.000Z',
      }),
    };
    repo.getByParty.mockImplementation(async (kind: string, id: string) => threads[`${kind}:${id}`] ?? null);

    const list = await scope.assignedConversations('tech-1');
    expect(list.map((c) => c.id)).toEqual(['c-ct2', 'c-me', 'c-ct1']);
    const looked = repo.getByParty.mock.calls.map((c) => c.join(':'));
    expect(looked).toEqual(expect.arrayContaining(['contact:ct1', 'contact:ct2', 'company:co1', 'user:tech-1']));
    expect(looked).not.toContain('contact:ct3');
    expect(looked.filter((k) => k === 'contact:ct1')).toHaveLength(1);
  });

  it('yields only the own thread when the deal service is down', async () => {
    const { scope, repo, deals } = make();
    deals.listByTech.mockResolvedValue(null);
    const mine = createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1' });
    repo.getByParty.mockImplementation(async (kind: string) => (kind === 'user' ? mine : null));
    expect(await scope.assignedConversations('tech-1')).toEqual([mine]);
  });

  it('includes the groups the technician is a member of, read through CONVOF#group#', async () => {
    const { scope, repo } = make();
    repo.listMemberOf.mockResolvedValue([{ conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: '2026-09-01T00:00:00.000Z' }]);
    const group = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1'], lastMessageAt: '2026-09-14T00:00:00.000Z' });
    repo.getByParty.mockImplementation(async (kind: string, id: string) => (kind === 'group' && id === 'g1' ? group : null));
    expect((await scope.assignedConversations('tech-1')).map((c) => c.id)).toEqual(['g1']);
    expect(repo.getByParty).toHaveBeenCalledWith('group', 'g1');
  });
});
