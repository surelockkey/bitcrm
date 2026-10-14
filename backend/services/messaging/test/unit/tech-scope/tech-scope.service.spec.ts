import { type DealForMessaging } from '../../../src/api/access/deal-read.service';
import { TECH_SCOPE_MAX_AGE_MS, TechScopeService } from '../../../src/tech-scope/tech-scope.service';
import { createMockDeal } from '../api/api-mocks';
import { FakeTechScopeRepo } from './fake-tech-scope-repo';

const T0 = Date.parse('2026-10-13T12:00:00.000Z');

/** deal-service as a mutable world: jobs by id; by-tech answers from them (active, roster-filtered by the caller). */
function world(initial: DealForMessaging[] = []) {
  const jobs = new Map(initial.map((d) => [d.id, d]));
  let down = false;
  const deals = {
    find: jest.fn(async (id: string) => (down ? null : jobs.get(id) ?? null)),
    listByTech: jest.fn(async (techId: string) => {
      if (down) return null;
      // Like TechIndex: the ASSIGN# rows of the tech, deleted jobs filtered out.
      return [...jobs.values()].filter((d) => d.status !== 'deleted' && d.assignedTechIds.includes(techId));
    }),
    forget: jest.fn(),
  };
  return {
    jobs,
    deals,
    set: (d: DealForMessaging) => jobs.set(d.id, d),
    down: (v: boolean) => (down = v),
  };
}

function make(initial: DealForMessaging[] = [], opts: { ready?: boolean } = {}) {
  const w = world(initial);
  const repo = new FakeTechScopeRepo();
  if (opts.ready !== false) repo.state = { readyAt: '2026-10-13T00:00:00.000Z', count: 0 };
  let now = T0;
  const svc = new TechScopeService(repo as never, w.deals as never, () => now);
  return { svc, repo, w, tick: (ms: number) => (now += ms) };
}

describe('TechScopeService.jobParties — the read path', () => {
  it('before the backfill stamped the gate: the live path, and nothing is stored', async () => {
    const { svc, repo, w } = make([createMockDeal({ id: 'd1', contactId: 'ct1' })], { ready: false });
    expect(await svc.jobParties('tech-1')).toEqual([{ kind: 'contact', id: 'ct1' }]);
    expect(w.deals.listByTech).toHaveBeenCalledWith('tech-1');
    expect(repo.get).not.toHaveBeenCalled();
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('the gate is asked once a minute while closed, and remembered once open', async () => {
    const { svc, repo, tick } = make([], { ready: false });
    await svc.jobParties('tech-1');
    await svc.jobParties('tech-1');
    expect(repo.getState).toHaveBeenCalledTimes(1);
    repo.state = { readyAt: 'x', count: 1 };
    tick(61_000);
    await svc.jobParties('tech-1');
    tick(10 * 60_000);
    await svc.jobParties('tech-1');
    expect(repo.getState).toHaveBeenCalledTimes(2);
  });

  it('a stored row is served without asking deal-service', async () => {
    const { svc, repo, w } = make();
    repo.rows.set('tech-1', {
      userId: 'tech-1',
      deals: [{ id: 'd1', contactId: 'ct1', companyId: 'co1' }],
      computedAt: new Date(T0).toISOString(),
      dealCount: 1,
    });
    expect(await svc.jobParties('tech-1')).toEqual([
      { kind: 'contact', id: 'ct1' },
      { kind: 'company', id: 'co1' },
    ]);
    expect(w.deals.listByTech).not.toHaveBeenCalled();
  });

  it('no row yet: computed from a FRESH by-tech read, stored, answered', async () => {
    const { svc, repo, w } = make([createMockDeal({ id: 'd1', contactId: 'ct1' })]);
    expect(await svc.jobParties('tech-1')).toEqual([{ kind: 'contact', id: 'ct1' }]);
    expect(w.deals.listByTech).toHaveBeenCalledWith('tech-1', { fresh: true });
    expect(repo.rows.get('tech-1')).toMatchObject({ deals: [{ id: 'd1', contactId: 'ct1' }], dealCount: 1 });
  });

  it('no row and deal-service down: no client threads (today’s outage answer), nothing stored', async () => {
    const { svc, repo, w } = make();
    w.down(true);
    expect(await svc.jobParties('tech-1')).toEqual([]);
    expect(repo.rows.size).toBe(0);
  });

  it('a row older than the max age is served, and rebuilt behind the request', async () => {
    const { svc, repo, w, tick } = make([createMockDeal({ id: 'd2', contactId: 'ct2' })]);
    repo.rows.set('tech-1', {
      userId: 'tech-1',
      deals: [{ id: 'd1', contactId: 'ct1' }],
      computedAt: new Date(T0).toISOString(),
      dealCount: 1,
    });
    tick(TECH_SCOPE_MAX_AGE_MS + 1);
    expect(await svc.jobParties('tech-1')).toEqual([{ kind: 'contact', id: 'ct1' }]);
    await svc.settled();
    expect(repo.rows.get('tech-1')!.deals).toEqual([{ id: 'd2', contactId: 'ct2' }]);
    expect(w.deals.listByTech).toHaveBeenCalledTimes(1);
  });

  it('a row it cannot read sends the request down the live path', async () => {
    const { svc, repo } = make([createMockDeal({ id: 'd1', contactId: 'ct1' })]);
    repo.get.mockRejectedValueOnce(new Error('throttled'));
    expect(await svc.jobParties('tech-1')).toEqual([{ kind: 'contact', id: 'ct1' }]);
  });
});

describe('TechScopeService.onDealEvent — kept current by job events', () => {
  async function seeded() {
    const m = make([
      createMockDeal({ id: 'd1', contactId: 'ct1', assignedTechIds: ['tech-1'] }),
      createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-1', 'tech-2'] }),
    ]);
    await m.svc.rebuild(['tech-1', 'tech-2'], { apply: true });
    m.w.deals.listByTech.mockClear();
    return m;
  }
  const parties = async (svc: TechScopeService, id: string) => (await svc.jobParties(id)).map((p) => p.id);

  it('assigned: the technician gains the job’s client', async () => {
    const { svc, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd3', contactId: 'ct3', assignedTechIds: ['tech-2'] }));
    await svc.onDealEvent('d3', ['tech-2']);
    expect(await parties(svc, 'tech-2')).toEqual(['ct2', 'ct3']);
    expect(w.deals.find).toHaveBeenCalledWith('d3', { fresh: true });
  });

  it('assigned while TechIndex still lags: the job read fresh is laid over the index', async () => {
    const { svc, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd3', contactId: 'ct3', assignedTechIds: ['tech-2'] }));
    const answer = await w.deals.listByTech('tech-2');
    w.deals.listByTech.mockResolvedValueOnce(answer!.filter((d) => d.id !== 'd3'));
    await svc.onDealEvent('d3', ['tech-2']);
    expect((await parties(svc, 'tech-2')).sort()).toEqual(['ct2', 'ct3']);
  });

  it('unassigned: the technician the event names loses the client', async () => {
    const { svc, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-1'] }));
    await svc.onDealEvent('d2', ['tech-2']);
    expect(await parties(svc, 'tech-2')).toEqual([]);
    expect(await parties(svc, 'tech-1')).toEqual(['ct1', 'ct2']);
  });

  it('client changed: the job’s technicians follow it', async () => {
    const { svc, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd2', contactId: 'ct9', companyId: 'co9', assignedTechIds: ['tech-1', 'tech-2'] }));
    await svc.onDealEvent('d2');
    expect(await parties(svc, 'tech-1')).toEqual(['ct1', 'ct9', 'co9']);
    expect(await parties(svc, 'tech-2')).toEqual(['ct9', 'co9']);
  });

  it('deleted: gone from every technician that was on it', async () => {
    const { svc, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-1', 'tech-2'], status: 'deleted' }));
    await svc.onDealEvent('d2');
    expect(await parties(svc, 'tech-1')).toEqual(['ct1']);
    expect(await parties(svc, 'tech-2')).toEqual([]);
  });

  it('an event that changes nothing for a row (not cut at 100) costs no by-tech read', async () => {
    const { svc, w } = await seeded();
    await svc.onDealEvent('d1'); // e.g. a payment-status deal.updated
    expect(w.deals.listByTech).not.toHaveBeenCalled();
  });

  it('a row that may have been cut at 100 is always recomputed', async () => {
    const many = Array.from({ length: 100 }, (_, i) => createMockDeal({ id: `d${i}`, contactId: `ct${i}` }));
    const { svc, w } = make(many);
    await svc.rebuild(['tech-1'], { apply: true });
    w.deals.listByTech.mockClear();
    await svc.onDealEvent('d5');
    expect(w.deals.listByTech).toHaveBeenCalledWith('tech-1', { fresh: true });
  });

  it('deal-service down mid-recompute: the row is dropped (never left stale) and the next read takes the live path', async () => {
    const { svc, repo, w, tick } = await seeded();
    tick(1000);
    w.set(createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-1'] }));
    w.deals.listByTech.mockResolvedValueOnce(null);
    await svc.onDealEvent('d2', ['tech-2']);
    expect(repo.rows.has('tech-2')).toBe(false);
    expect(await parties(svc, 'tech-2')).toEqual([]);
  });

  it('never throws — the automations share the queue message', async () => {
    const { svc, w } = await seeded();
    w.deals.find.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.onDealEvent('d1')).resolves.toBeUndefined();
  });

  it('two recomputes racing: the one read last wins', async () => {
    const { svc, repo } = await seeded();
    const newer = { userId: 'tech-1', deals: [{ id: 'dN' }], computedAt: '2026-10-13T13:00:00.000Z', dealCount: 1 };
    await repo.put(newer);
    // An event whose by-tech read started at T0 (earlier) must not overwrite it.
    await svc.onDealEvent('d2', ['tech-1']);
    expect(repo.rows.get('tech-1')!.deals).toEqual([{ id: 'dN' }]);
  });
});

describe('TechScopeService.onContactMerged', () => {
  it('the duplicate becomes the survivor in every row that holds it', async () => {
    const { svc } = make([
      createMockDeal({ id: 'd1', contactId: 'dup', assignedTechIds: ['tech-1', 'tech-2'] }),
      createMockDeal({ id: 'd2', contactId: 'ct2', assignedTechIds: ['tech-1'] }),
    ]);
    await svc.rebuild(['tech-1', 'tech-2'], { apply: true });
    await svc.onContactMerged('dup', 'win');
    expect((await svc.jobParties('tech-1')).map((p) => p.id)).toEqual(['win', 'ct2']);
    expect((await svc.jobParties('tech-2')).map((p) => p.id)).toEqual(['win']);
  });
});

describe('TechScopeService.rebuild — the reconciling backfill', () => {
  it('dry run counts and writes nothing, not even the gate', async () => {
    const { svc, repo } = make([createMockDeal({ id: 'd1', contactId: 'ct1' })], { ready: false });
    const stats = await svc.rebuild(['tech-1', 'office-1'], { apply: false });
    expect(stats).toMatchObject({ users: 2, written: 1, skipped: 1, failed: 0, stateStamped: false });
    expect(repo.put).not.toHaveBeenCalled();
    expect(repo.state).toBeNull();
  });

  it('apply: writes what changed, leaves what is right, removes rows of users that are gone, stamps the gate', async () => {
    const { svc, repo } = make([createMockDeal({ id: 'd1', contactId: 'ct1' })], { ready: false });
    repo.rows.set('gone-1', { userId: 'gone-1', deals: [{ id: 'dx' }], computedAt: '2026-01-01T00:00:00.000Z', dealCount: 1 });
    repo.rows.set('tech-1', { userId: 'tech-1', deals: [{ id: 'd1', contactId: 'ct1' }], computedAt: '2026-01-01T00:00:00.000Z', dealCount: 1 });
    repo.rows.set('tech-2', { userId: 'tech-2', deals: [{ id: 'old', contactId: 'x' }], computedAt: '2026-01-01T00:00:00.000Z', dealCount: 1 });
    const stats = await svc.rebuild(['tech-1', 'tech-2'], { apply: true });
    expect(stats).toMatchObject({ unchanged: 1, written: 1, removed: 1, failed: 0, stateStamped: true });
    expect(repo.rows.has('gone-1')).toBe(false);
    expect(repo.rows.get('tech-2')!.deals).toEqual([]); // reconciled: the stale job is gone
    expect(repo.state).toMatchObject({ count: 2 });
    expect(await svc.isReady()).toBe(true);
  });

  it('a user deal-service cannot answer for keeps the gate closed', async () => {
    const { svc, repo, w } = make([], { ready: false });
    w.down(true);
    const stats = await svc.rebuild(['tech-1'], { apply: true });
    expect(stats).toMatchObject({ failed: 1, stateStamped: false });
    expect(repo.state).toBeNull();
  });
});
