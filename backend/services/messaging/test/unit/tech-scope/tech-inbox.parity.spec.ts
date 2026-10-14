import { type Conversation, type ConversationMember, type ConversationPointerKind } from '@bitcrm/types';
import { type DealForMessaging } from '../../../src/api/access/deal-read.service';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { ConversationsService, matchesView } from '../../../src/api/conversations/conversations.service';
import { conversationActivityAt } from '../../../src/conversations/conversation-keys';
import { TechScopeService } from '../../../src/tech-scope/tech-scope.service';
import { createMockConversation } from '../mocks';
import { TECH, createMockDeal, mockOptOutsRepo, techPerms } from '../api/api-mocks';
import { FakeTechScopeRepo } from './fake-tech-scope-repo';

/**
 * C4 parity: the technician inbox served from the stored scope must be
 * EXACTLY the inbox the pre-C4 code computed on every request — the same
 * conversations, in the same order, paged the same way — for every tab, and
 * stay so as jobs are assigned, unassigned, re-pointed and deleted.
 *
 * The oracle below is the pre-C4 `assignedConversations`, verbatim in logic:
 * deal-service's by-tech answer → roster filter → contact / company parties,
 * the own team thread, the groups (MEMBEROF#), one `getByParty` each.
 */
async function preC4AssignedConversations(
  userId: string,
  deals: { listByTech(id: string): Promise<DealForMessaging[] | null> },
  repo: FakeConversations,
): Promise<Conversation[]> {
  const list = (await deals.listByTech(userId)) ?? [];
  const parties = new Map<string, { kind: ConversationPointerKind; id: string }>();
  for (const deal of list) {
    if (!deal.assignedTechIds.includes(userId)) continue;
    if (deal.contactId) parties.set(`contact:${deal.contactId}`, { kind: 'contact', id: deal.contactId });
    if (deal.companyId) parties.set(`company:${deal.companyId}`, { kind: 'company', id: deal.companyId });
  }
  parties.set(`user:${userId}`, { kind: 'user', id: userId });
  for (const m of await repo.listMemberOf(userId)) parties.set(`group:${m.conversationId}`, { kind: 'group', id: m.conversationId });
  const found = new Map<string, Conversation>();
  for (const p of parties.values()) {
    const c = await repo.getByParty(p.kind, p.id);
    if (c) found.set(c.id, c);
  }
  return [...found.values()].sort((a, b) => conversationActivityAt(b).localeCompare(conversationActivityAt(a)));
}

/** The conversations table: threads by party (CONVOF#) and group rosters (MEMBEROF#). */
class FakeConversations {
  byParty = new Map<string, Conversation>();
  members: ConversationMember[] = [];

  add(c: Conversation) {
    this.byParty.set(`${c.partyKind}:${c.partyId}`, c);
    return c;
  }
  getByParty = jest.fn(async (kind: string, id: string) => this.byParty.get(`${kind}:${id}`) ?? null);
  getManyByParty = jest.fn(async (parties: Array<{ kind: string; id: string }>) => {
    const out = new Map<string, Conversation>();
    for (const p of parties) {
      const c = this.byParty.get(`${p.kind}:${p.id}`);
      if (c) out.set(`${p.kind}:${p.id}`, c);
    }
    return out;
  });
  listMemberOf = jest.fn(async (userId: string) => this.members.filter((m) => m.userId === userId));
}

const at = (day: number, hour = 12) => `2026-09-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function fixture() {
  const jobs = new Map<string, DealForMessaging>();
  const put = (d: DealForMessaging) => jobs.set(d.id, d);
  // Three technicians, eight jobs; shared clients, a company job, a job with no thread, a deleted one.
  put(createMockDeal({ id: 'd1', contactId: 'ct1', assignedTechIds: ['tech-1'] }));
  put(createMockDeal({ id: 'd2', contactId: 'ct2', companyId: 'co1', assignedTechIds: ['tech-1', 'tech-2'] }));
  put(createMockDeal({ id: 'd3', contactId: 'ct1', assignedTechIds: ['tech-2'] }));
  put(createMockDeal({ id: 'd4', contactId: 'ct3', assignedTechIds: ['tech-3'] }));
  put(createMockDeal({ id: 'd5', contactId: 'ct4', assignedTechIds: ['tech-1', 'tech-3'] }));
  put(createMockDeal({ id: 'd6', contactId: 'ct-nothread', assignedTechIds: ['tech-1'] }));
  put(createMockDeal({ id: 'd7', contactId: 'ct5', assignedTechIds: ['tech-2'], status: 'deleted' }));
  put(createMockDeal({ id: 'd8', companyId: 'co2', assignedTechIds: ['tech-3', 'tech-1'] }));

  let down = false;
  const deals = {
    find: jest.fn(async (id: string) => (down ? null : jobs.get(id) ?? null)),
    listByTech: jest.fn(async (techId: string) =>
      down ? null : [...jobs.values()].filter((d) => d.status !== 'deleted' && d.assignedTechIds.includes(techId)),
    ),
    forget: jest.fn(),
  };

  const convs = new FakeConversations();
  const c = (id: string, over: Partial<Conversation>) => convs.add(createMockConversation({ id, ...over }));
  c('c-ct1', { partyKind: 'contact', partyId: 'ct1', lastMessageAt: at(10), unread: true });
  c('c-ct2', { partyKind: 'contact', partyId: 'ct2', lastMessageAt: at(14), flagged: true, categoryId: 'cat-a' });
  c('c-co1', { kind: 'company' as never, partyKind: 'company', partyId: 'co1', lastMessageAt: at(12) });
  c('c-ct3', { partyKind: 'contact', partyId: 'ct3', lastMessageAt: at(9), state: 'archived' });
  c('c-ct4', { partyKind: 'contact', partyId: 'ct4', lastMessageAt: at(11), unread: true, categoryId: 'cat-a' });
  c('c-ct5', { partyKind: 'contact', partyId: 'ct5', lastMessageAt: at(15) }); // only on a deleted job
  c('c-co2', { kind: 'company' as never, partyKind: 'company', partyId: 'co2', lastMessageAt: at(12) }); // ties c-co1
  c('c-ct9', { partyKind: 'contact', partyId: 'ct9', lastMessageAt: at(16) }); // nobody's job (yet)
  for (const t of ['tech-1', 'tech-2', 'tech-3']) {
    c(`team-${t}`, { kind: 'team', partyKind: 'user', partyId: t, lastMessageAt: at(8 + Number(t.slice(-1))) });
  }
  c('g1', { kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1', 'tech-2'], lastMessageAt: at(13), state: 'archived' });
  c('g2', { kind: 'group', partyKind: 'group', partyId: 'g2', memberIds: ['tech-3'], lastMessageAt: at(7) });
  convs.members.push(
    { conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: at(1) },
    { conversationId: 'g1', userId: 'tech-2', role: 'member', joinedAt: at(1) },
    { conversationId: 'g2', userId: 'tech-3', role: 'member', joinedAt: at(1) },
  );

  const scopeRepo = new FakeTechScopeRepo();
  const techScope = new TechScopeService(scopeRepo as never, deals as never, () => Date.parse('2026-09-20T00:00:00.000Z'));
  const scope = new ConversationScopeService(convs as never, deals as never, techScope);
  const service = new ConversationsService(convs as never, mockOptOutsRepo() as never, scope, deals as never);
  return { jobs, put, deals, convs, scopeRepo, techScope, service, setDown: (v: boolean) => (down = v) };
}

const TECHS = ['tech-1', 'tech-2', 'tech-3'];
const VIEWS = [
  { view: 'all' },
  { view: 'unread' },
  { view: 'flagged' },
  { view: 'archived' },
  { view: 'mine' },
  { view: 'all', kind: 'client' },
  { view: 'all', categoryId: 'cat-a' },
] as const;

/** Every page of one tab, through the public list(). */
async function walk(f: ReturnType<typeof fixture>, techId: string, q: (typeof VIEWS)[number], limit: number) {
  const pages: string[][] = [];
  let cursor: string | undefined;
  do {
    const page = await f.service.list({ ...q, limit, cursor } as never, { ...TECH, id: techId }, techPerms());
    pages.push(page.items.map((c) => c.id));
    cursor = page.nextCursor;
  } while (cursor && pages.length < 50);
  return pages;
}

/** The oracle's pages for the same tab: filter, then slice — what pre-C4 listScoped did. */
async function oraclePages(f: ReturnType<typeof fixture>, techId: string, q: (typeof VIEWS)[number], limit: number) {
  const all = (await preC4AssignedConversations(techId, f.deals, f.convs)).filter((c) => matchesView(c, q as never, techId));
  const pages: string[][] = [];
  for (let o = 0; o < all.length || o === 0; o += limit) pages.push(all.slice(o, o + limit).map((c) => c.id));
  return pages;
}

async function expectParity(f: ReturnType<typeof fixture>) {
  for (const techId of TECHS) {
    for (const q of VIEWS) {
      for (const limit of [1, 2, 50]) {
        expect({ techId, q, limit, pages: await walk(f, techId, q, limit) }).toEqual({
          techId,
          q,
          limit,
          pages: await oraclePages(f, techId, q, limit),
        });
      }
    }
  }
}

describe('C4 — technician inbox parity with the pre-C4 computation', () => {
  it('gate closed (live path): identical to the oracle', async () => {
    const f = fixture();
    await expectParity(f);
    expect(f.scopeRepo.get).not.toHaveBeenCalled();
  });

  it('gate open (stored rows from the backfill): identical, and no deal-service call per request', async () => {
    const f = fixture();
    const stats = await f.techScope.rebuild(TECHS, { apply: true });
    expect(stats.stateStamped).toBe(true);
    f.deals.listByTech.mockClear();
    const page = await f.service.list({ view: 'all', limit: 50 } as never, TECH, techPerms());
    expect(f.deals.listByTech).not.toHaveBeenCalled();
    // Open threads, newest first; c-co1 / c-co2 tie and keep party order (d2 before d8); g1 is archived.
    expect(page.items.map((c) => c.id)).toEqual(['c-ct2', 'c-co1', 'c-co2', 'c-ct4', 'c-ct1', 'team-tech-1']);
    await expectParity(f);
  });

  it('stays identical as jobs are assigned, unassigned, re-pointed, deleted and restored', async () => {
    const f = fixture();
    await f.techScope.rebuild(TECHS, { apply: true });
    const event = async (dealId: string, techIds: string[] = []) => {
      await f.techScope.onDealEvent(dealId, techIds);
      await expectParity(f);
    };

    // tech-2 is put on d4 (ct3's archived thread joins their Archived tab).
    f.put({ ...f.jobs.get('d4')!, assignedTechIds: ['tech-3', 'tech-2'] });
    await event('d4', ['tech-2']);

    // tech-1 comes off d2 (still sees co1? no — only d2 had it; ct2 goes too).
    f.put({ ...f.jobs.get('d2')!, assignedTechIds: ['tech-2'] });
    await event('d2', ['tech-1']);

    // d5 moves to another client, one with a thread nobody saw before.
    f.put({ ...f.jobs.get('d5')!, contactId: 'ct9' });
    await event('d5');

    // d1 is deleted; d7 is restored.
    f.put({ ...f.jobs.get('d1')!, status: 'deleted' });
    await event('d1');
    f.put({ ...f.jobs.get('d7')!, status: 'active' });
    await event('d7');

    // A brand-new job, created already assigned.
    f.put(createMockDeal({ id: 'd9', contactId: 'ct3', companyId: 'co1', assignedTechIds: ['tech-1'] }));
    await event('d9');
  });

  it('group membership and the own team thread need no event: they are read live', async () => {
    const f = fixture();
    await f.techScope.rebuild(TECHS, { apply: true });
    f.convs.members.push({ conversationId: 'g2', userId: 'tech-1', role: 'member', joinedAt: at(2) });
    f.convs.add(createMockConversation({ id: 'team-tech-1b', kind: 'team', partyKind: 'user', partyId: 'tech-1', lastMessageAt: at(20) }));
    await expectParity(f);
  });

  it('a thread created later for a client already in scope shows up with no event', async () => {
    const f = fixture();
    await f.techScope.rebuild(TECHS, { apply: true });
    f.convs.add(createMockConversation({ id: 'c-nothread', partyKind: 'contact', partyId: 'ct-nothread', lastMessageAt: at(18) }));
    await expectParity(f);
    expect((await f.service.list({ view: 'all', limit: 1 } as never, TECH, techPerms())).items[0].id).toBe('c-nothread');
  });

  it('deal-service down: the stored inbox still answers; the live path (gate closed) shows only own threads, as before', async () => {
    const f = fixture();
    await f.techScope.rebuild(TECHS, { apply: true });
    const before = await walk(f, 'tech-1', VIEWS[0], 50);
    f.setDown(true);
    expect(await walk(f, 'tech-1', VIEWS[0], 50)).toEqual(before);

    const closed = fixture();
    closed.setDown(true);
    await expectParity(closed);
  });
});
