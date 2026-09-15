import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { ConversationsService, matchesView } from '../../../src/api/conversations/conversations.service';
import { decodeCursor, encodeCursor } from '../../../src/common/cursor';
import { UnsupportedInboxFilterError } from '../../../src/conversations/conversations.repository';
import { createMockConversation, createMockOptOut } from '../mocks';
import {
  ADMIN,
  TECH,
  adminPerms,
  createMockDeal,
  mockConversationsRepo,
  mockDealRead,
  mockOptOutsRepo,
  techPerms,
} from './api-mocks';

function make() {
  const repo = mockConversationsRepo();
  const optOuts = mockOptOutsRepo();
  const deals = mockDealRead();
  const scope = new ConversationScopeService(repo as never, deals as never);
  const svc = new ConversationsService(repo as never, optOuts as never, scope, deals as never);
  return { svc, repo, optOuts, deals, scope };
}

const CLIENT = createMockConversation({ id: 'c1', partyId: 'ct1', addresses: { phones: ['+14045551234'], emails: [] } });

describe('ConversationsService.list — full scope', () => {
  it('passes view/kind/categoryId and the cursor straight to the repository and hands its cursor back', async () => {
    const { svc, repo } = make();
    repo.listInbox.mockResolvedValue({ items: [CLIENT], nextCursor: 'CUR2' });

    const page = await svc.list({ view: 'unread', limit: 25, cursor: 'CUR1' }, ADMIN, adminPerms());

    expect(repo.listInbox).toHaveBeenCalledWith({ view: 'unread', kind: undefined, categoryId: undefined }, { limit: 25, cursor: 'CUR1' });
    expect(page.nextCursor).toBe('CUR2');
    expect(page.items[0].addresses.phones).toEqual(['+14045551234']); // admin sees numbers
  });

  it('narrows view=all by kind / categoryId', async () => {
    const { svc, repo } = make();
    await svc.list({ view: 'all', kind: 'team', limit: 50 }, ADMIN, adminPerms());
    expect(repo.listInbox.mock.calls[0][0]).toEqual({ view: 'all', kind: 'team', categoryId: undefined });
  });

  it('turns a bad cursor / unindexed combination into a 400', async () => {
    const { svc, repo } = make();
    repo.listInbox.mockRejectedValue(new UnsupportedInboxFilterError({ view: 'unread', kind: 'team' }));
    await expect(svc.list({ view: 'unread', kind: 'team', limit: 50 }, ADMIN, adminPerms())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(svc.list({ view: 'all', limit: 50, cursor: '%%%' }, ADMIN, adminPerms())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('masks the phones for a full-scope viewer without contacts.view_numbers', async () => {
    const { svc, repo } = make();
    repo.listInbox.mockResolvedValue({ items: [CLIENT] });
    const perms = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: true, view_numbers: false } } });
    const page = await svc.list({ view: 'all', limit: 50 }, ADMIN, perms);
    expect(page.items[0].addresses.phones).toEqual([]);
    expect(page.items[0].phonesMasked).toBe(true);
  });
});

describe('ConversationsService.list — view=mine (bounded walk)', () => {
  const mine = (id: string) => createMockConversation({ id, assignedUserId: 'admin-1' });
  const other = (id: string) => createMockConversation({ id, assignedUserId: 'someone' });

  it('walks the open inbox and keeps only the caller’s assignments, resuming mid-page', async () => {
    const { svc, repo } = make();
    const pages: Record<string, { items: unknown[]; nextCursor?: string }> = {
      start: { items: [other('a'), mine('b'), other('c'), mine('d'), mine('e')], nextCursor: 'P2' },
      P2: { items: [mine('f')], nextCursor: undefined },
    };
    repo.listInbox.mockImplementation(async (_q: unknown, opts: { cursor?: string }) => pages[opts.cursor ?? 'start']);

    const first = await svc.list({ view: 'mine', limit: 2 }, ADMIN, adminPerms());
    expect(first.items.map((c) => c.id)).toEqual(['b', 'd']);
    expect(repo.listInbox).toHaveBeenCalledWith({ view: 'all', kind: undefined, categoryId: undefined }, { limit: 100, cursor: undefined });
    // stopped inside page 1 at index 3 → resume the same page at offset 4
    expect(decodeCursor(first.nextCursor)).toEqual({ o: 4 });

    const second = await svc.list({ view: 'mine', limit: 2, cursor: first.nextCursor }, ADMIN, adminPerms());
    expect(second.items.map((c) => c.id)).toEqual(['e', 'f']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('hands the next page cursor back when the page ends exactly at the limit', async () => {
    const { svc, repo } = make();
    repo.listInbox.mockResolvedValueOnce({ items: [mine('a'), mine('b')], nextCursor: 'P2' });
    const page = await svc.list({ view: 'mine', limit: 2 }, ADMIN, adminPerms());
    expect(decodeCursor(page.nextCursor)).toEqual({ p: 'P2', o: 0 });
  });

  it('stops after the walk budget and returns a resumable cursor', async () => {
    const { svc, repo } = make();
    repo.listInbox.mockImplementation(async (_q: unknown, opts: { cursor?: string }) => ({
      items: [other('x')],
      nextCursor: `after-${opts.cursor ?? 'start'}`,
    }));
    const page = await svc.list({ view: 'mine', limit: 5 }, ADMIN, adminPerms());
    expect(page.items).toEqual([]);
    expect(repo.listInbox).toHaveBeenCalledTimes(10);
    expect(typeof page.nextCursor).toBe('string');
  });

  it('rejects a cursor of the wrong shape', async () => {
    const { svc } = make();
    await expect(
      svc.list({ view: 'mine', limit: 5, cursor: encodeCursor({ o: 'nope' }) }, ADMIN, adminPerms()),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ConversationsService.list — assigned_only', () => {
  function withThreads() {
    const ctx = make();
    ctx.deals.listByTech.mockResolvedValue([createMockDeal({ id: 'd1', contactId: 'ct1' }), createMockDeal({ id: 'd2', contactId: 'ct2' })]);
    const threads: Record<string, ReturnType<typeof createMockConversation>> = {
      'contact:ct1': createMockConversation({ id: 'c1', partyId: 'ct1', unread: true, unreadCount: 2, lastMessageAt: '2026-09-14T00:00:00.000Z' }),
      'contact:ct2': createMockConversation({ id: 'c2', partyId: 'ct2', flagged: true, state: 'archived', lastMessageAt: '2026-09-13T00:00:00.000Z' }),
      'user:tech-1': createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', lastMessageAt: '2026-09-12T00:00:00.000Z' }),
    };
    ctx.repo.getByParty.mockImplementation(async (kind: string, id: string) => threads[`${kind}:${id}`] ?? null);
    return ctx;
  }

  it('never queries the inbox indexes; pages the jobs’ threads in memory with an offset cursor', async () => {
    const { svc, repo } = withThreads();
    const first = await svc.list({ view: 'all', limit: 1 }, TECH, techPerms());
    expect(repo.listInbox).not.toHaveBeenCalled();
    expect(first.items.map((c) => c.id)).toEqual(['c1']);
    expect(decodeCursor(first.nextCursor)).toEqual({ o: 1 });

    const second = await svc.list({ view: 'all', limit: 1, cursor: first.nextCursor }, TECH, techPerms());
    expect(second.items.map((c) => c.id)).toEqual(['c-me']); // c2 is archived → not in "all"
    expect(second.nextCursor).toBeUndefined();
  });

  it('applies the tab semantics in memory', async () => {
    const { svc } = withThreads();
    expect((await svc.list({ view: 'unread', limit: 10 }, TECH, techPerms())).items.map((c) => c.id)).toEqual(['c1']);
    expect((await svc.list({ view: 'flagged', limit: 10 }, TECH, techPerms())).items.map((c) => c.id)).toEqual(['c2']);
    expect((await svc.list({ view: 'archived', limit: 10 }, TECH, techPerms())).items.map((c) => c.id)).toEqual(['c2']);
    expect((await svc.list({ view: 'all', kind: 'team', limit: 10 }, TECH, techPerms())).items.map((c) => c.id)).toEqual(['c-me']);
  });

  it('masks phones for the technician', async () => {
    const { svc } = withThreads();
    const page = await svc.list({ view: 'all', limit: 10 }, TECH, techPerms());
    expect(page.items[0].phonesMasked).toBe(true);
    expect(page.items[0].addresses.phones).toEqual([]);
  });
});

describe('matchesView', () => {
  it('mine = open and assigned to the caller', () => {
    expect(matchesView(createMockConversation({ assignedUserId: 'u1' }), { view: 'mine' }, 'u1')).toBe(true);
    expect(matchesView(createMockConversation({ assignedUserId: 'u1', state: 'archived' }), { view: 'mine' }, 'u1')).toBe(false);
    expect(matchesView(createMockConversation({ assignedUserId: 'u2' }), { view: 'mine' }, 'u1')).toBe(false);
  });

  it('categoryId narrows', () => {
    expect(matchesView(createMockConversation({ categoryId: 'vip' }), { view: 'all', categoryId: 'vip' }, 'u1')).toBe(true);
    expect(matchesView(createMockConversation(), { view: 'all', categoryId: 'vip' }, 'u1')).toBe(false);
  });
});

describe('ConversationsService.get', () => {
  it('returns the conversation with the caller’s read marker', async () => {
    const { svc, repo } = make();
    repo.get.mockResolvedValue(CLIENT);
    repo.getReadMarker.mockResolvedValue({ conversationId: 'c1', userId: 'admin-1', lastReadAt: 'T' });
    const detail = await svc.get('c1', ADMIN, adminPerms());
    expect(detail.id).toBe('c1');
    expect(detail.readMarker).toEqual({ conversationId: 'c1', userId: 'admin-1', lastReadAt: 'T' });
    expect(repo.getReadMarker).toHaveBeenCalledWith('c1', 'admin-1');
  });

  it('404s when missing and 403s outside the technician’s scope', async () => {
    const { svc, repo } = make();
    await expect(svc.get('nope', ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    repo.get.mockResolvedValue(CLIENT); // party ct1, tech has no deals
    await expect(svc.get('c1', TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a technician read a thread of their own job, masked', async () => {
    const { svc, repo, deals } = make();
    repo.get.mockResolvedValue(CLIENT);
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const detail = await svc.get('c1', TECH, techPerms());
    expect(detail.phonesMasked).toBe(true);
  });
});

describe('ConversationsService lookups', () => {
  it('getByParty validates the kind, 404s on a miss and enforces scope', async () => {
    const { svc, repo } = make();
    await expect(svc.getByParty('planet', 'x', ADMIN, adminPerms())).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.getByParty('contact', 'ct1', ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    repo.getByParty.mockResolvedValue(CLIENT);
    expect((await svc.getByParty('contact', 'ct1', ADMIN, adminPerms())).id).toBe('c1');
    await expect(svc.getByParty('contact', 'ct1', TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('getByAddress follows the ADDR# pointer (emails lowercased)', async () => {
    const { svc, repo } = make();
    repo.getByAddress.mockResolvedValue({ address: 'jane@example.com', conversationId: 'c1' });
    repo.get.mockResolvedValue(CLIENT);
    expect((await svc.getByAddress('Jane@Example.com ', ADMIN, adminPerms())).id).toBe('c1');
    expect(repo.getByAddress).toHaveBeenCalledWith('jane@example.com');
    repo.getByAddress.mockResolvedValue(null);
    await expect(svc.getByAddress('+10000000000', ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getByJob resolves deal → contact (else company) → thread, roster-checked for technicians', async () => {
    const { svc, repo, deals } = make();
    deals.find.mockResolvedValue(createMockDeal({ contactId: 'ct1', companyId: 'co1', assignedTechIds: ['tech-2'] }));
    repo.getByParty.mockImplementation(async (kind: string) => (kind === 'company' ? createMockConversation({ id: 'c-co', partyKind: 'company', partyId: 'co1' }) : null));

    expect((await svc.getByJob('d1', ADMIN, adminPerms())).id).toBe('c-co');
    await expect(svc.getByJob('d1', TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);

    deals.find.mockResolvedValue(null);
    await expect(svc.getByJob('d1', ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getInternal returns the raw conversation or 404', async () => {
    const { svc, repo } = make();
    await expect(svc.getInternal('c1')).rejects.toBeInstanceOf(NotFoundException);
    repo.get.mockResolvedValue(CLIENT);
    expect(await svc.getInternal('c1')).toBe(CLIENT);
  });
});

describe('ConversationsService.textLookup', () => {
  it('requires a party or an address', async () => {
    const { svc } = make();
    await expect(svc.textLookup({}, ADMIN, adminPerms())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('by party: thread, its first phone, opt-out row and canText', async () => {
    const { svc, repo, optOuts } = make();
    repo.getByParty.mockResolvedValue(CLIENT);
    optOuts.get.mockResolvedValue(createMockOptOut({ status: 'opted_out' }));
    const res = await svc.textLookup({ partyKind: 'contact', partyId: 'ct1' }, ADMIN, adminPerms());
    expect(res.conversation?.id).toBe('c1');
    expect(res.address).toBe('+14045551234');
    expect(optOuts.get).toHaveBeenCalledWith('sms', '+14045551234');
    expect(res.optOut?.status).toBe('opted_out');
    expect(res.canText).toBe(false);
  });

  it('by address with no thread yet: null conversation, still textable', async () => {
    const { svc } = make();
    const res = await svc.textLookup({ address: '+14045559999' }, ADMIN, adminPerms());
    expect(res).toEqual({ conversation: null, address: '+14045559999', optOut: null, canText: true });
  });

  it('withholds the address from a masked viewer and enforces scope on an existing thread', async () => {
    const { svc, repo, deals } = make();
    repo.getByParty.mockResolvedValue(CLIENT);
    await expect(svc.textLookup({ partyKind: 'contact', partyId: 'ct1' }, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);

    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const res = await svc.textLookup({ partyKind: 'contact', partyId: 'ct1' }, TECH, techPerms());
    expect(res.address).toBeUndefined();
    expect(res.addressMasked).toBe(true);
    expect(res.canText).toBe(true);
    expect(res.conversation?.phonesMasked).toBe(true);
  });

  it('an email address is never masked and never checked against SMS opt-outs', async () => {
    const { svc, optOuts } = make();
    const res = await svc.textLookup({ address: 'Jane@Example.com' }, TECH, techPerms());
    expect(res.address).toBe('jane@example.com');
    expect(optOuts.get).not.toHaveBeenCalled();
  });
});
