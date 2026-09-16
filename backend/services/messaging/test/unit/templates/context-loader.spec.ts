import { ContextLoader } from '../../../src/templates/context-loader';
import { createMockConversation } from '../mocks';

type Route = { status?: number; data?: unknown; throws?: boolean };

/** A fetch that answers by URL path, records calls and returns envelopes like the services do. */
function fakeFetch(routes: Record<string, Route>) {
  const calls: Array<{ path: string; secret?: string }> = [];
  const fetchImpl = jest.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    calls.push({ path, secret: init?.headers?.['x-internal-secret'] });
    const route = routes[path];
    if (!route) return { ok: false, status: 404, json: async () => ({ success: false }) };
    if (route.throws) throw new Error('ECONNREFUSED');
    if (route.status && route.status !== 200) return { ok: false, status: route.status, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ success: true, data: route.data }) };
  });
  return { fetchImpl, calls };
}

const deal = {
  id: 'd1',
  dealNumber: 'K4T9ZW',
  contactId: 'ct1',
  companyId: 'co1',
  scheduledDate: '2026-09-15',
  scheduledTimeSlot: '14:30-16:00',
  address: { street: '12 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
  notes: 'Rekey',
  jobTypeId: 'jt1',
  sourceId: 'src1',
  externalCompanyId: 'ext1',
  assignedTechIds: ['u7', 'u8'],
  customFields: { cf1: 'Bring shims', cf2: ['A1'], cfGone: 'x' },
};

const routes: Record<string, Route> = {
  '/api/deals/internal/d1': { data: deal },
  '/api/deals/job-types/internal': { data: [{ id: 'jt1', name: 'Lock change', active: true }] },
  '/api/deals/job-sources/internal': { data: [{ id: 'src1', name: 'Google Ads', active: true }] },
  '/api/deals/external-companies/internal': { data: [{ id: 'ext1', name: 'Roadside Partner LLC', active: true }] },
  '/api/deals/custom-fields/internal': {
    data: [
      { id: 'cf1', name: 'Manager Note', type: 'text', active: true },
      { id: 'cf2', name: 'Choose Company ', type: 'multi_select', active: true },
      { id: 'cf3', name: 'Archived', type: 'text', active: false },
    ],
  },
  '/api/crm/contacts/internal/ct1': {
    data: { id: 'ct1', firstName: 'Jane', lastName: 'Doe', phones: ['+14045551234'], emails: [], addresses: [], companyId: 'co1' },
  },
  '/api/crm/companies/internal/co1': { data: { id: 'co1', title: 'Acme Property Mgmt', phones: [], emails: [] } },
  '/api/users/internal/u7': { data: { id: 'u7', firstName: 'Mike', lastName: 'Smith', phone: '+14045559876', email: 'm@x.io' } },
  '/api/users/internal/u8': { data: { id: 'u8', firstName: 'Ann', lastName: 'Lee' } },
  '/api/users/internal/u2': { data: { id: 'u2', firstName: 'Tom', lastName: 'Tech', phone: '+15550002222', email: 't@x.io' } },
};

function makeLoader(overrides: Record<string, Route> = {}, settings: Record<string, unknown> | null = { timezone: 'America/Chicago' }) {
  const { fetchImpl, calls } = fakeFetch({ ...routes, ...overrides });
  const conversations = { get: jest.fn(async (id: string) => (id === 'c1' ? createMockConversation({ lastDealId: 'd1' }) : id === 'team' ? createMockConversation({ id: 'team', kind: 'team', partyKind: 'user', partyId: 'u2' }) : null)) };
  const settingsRepo = { get: jest.fn(async () => settings) };
  return { loader: new ContextLoader(conversations as any, settingsRepo as any, fetchImpl), calls, conversations };
}

describe('ContextLoader', () => {
  beforeAll(() => {
    process.env.INTERNAL_SERVICE_SECRET ??= '';
  });

  it('assembles the full context from a deal id, resolving catalogs and custom-field names', async () => {
    const { loader, calls } = makeLoader();
    const ctx = await loader.load({ dealId: 'd1', userId: 'dispatcher' });

    expect(ctx.deal).toMatchObject({
      id: 'd1',
      dealNumber: 'K4T9ZW',
      jobTypeName: 'Lock change',
      jobSourceName: 'Google Ads',
      externalCompanyName: 'Roadside Partner LLC',
      assignedTechIds: ['u7', 'u8'],
    });
    expect(ctx.contact).toMatchObject({ firstName: 'Jane', phones: ['+14045551234'] });
    expect(ctx.company).toMatchObject({ title: 'Acme Property Mgmt' });
    expect(ctx.technician).toEqual({ firstName: 'Mike', lastName: 'Smith', phone: '+14045559876', email: 'm@x.io' });
    expect(ctx.customFields).toEqual({ 'Manager Note': 'Bring shims', 'Choose Company ': ['A1'] });
    expect(ctx.settings).toEqual({ timezone: 'America/Chicago' });
    expect(ctx.timezone).toBe('America/Chicago');
    expect(calls.map((c) => c.path)).toEqual(
      expect.arrayContaining(['/api/deals/internal/d1', '/api/crm/contacts/internal/ct1', '/api/crm/companies/internal/co1', '/api/users/internal/u7']),
    );
    expect(calls.every((c) => c.secret !== undefined)).toBe(true);
  });

  it('prefers the sending user as technician when they are on the roster', async () => {
    const { loader } = makeLoader();
    const ctx = await loader.load({ dealId: 'd1', userId: 'u8' });
    expect(ctx.technician).toMatchObject({ firstName: 'Ann' });
  });

  it('uses the sender as technician only when there is no job', async () => {
    const { loader } = makeLoader();
    expect((await loader.load({ userId: 'u7' })).technician).toMatchObject({ firstName: 'Mike' });
    expect((await loader.load({ userId: 'u2', dealId: 'd1' })).technician).toMatchObject({ firstName: 'Mike' });
  });

  it('takes the party and the last job from the conversation', async () => {
    const { loader } = makeLoader();
    const ctx = await loader.load({ conversationId: 'c1' });
    expect(ctx.contact?.firstName).toBe('Jane');
    expect(ctx.deal?.id).toBe('d1');
  });

  it('turns a team conversation partner into the contact', async () => {
    const { loader } = makeLoader();
    const ctx = await loader.load({ conversationId: 'team' });
    expect(ctx.contact).toEqual({ firstName: 'Tom', lastName: 'Tech', phones: ['+15550002222'], emails: ['t@x.io'] });
    expect(ctx.deal).toBeUndefined();
  });

  it('honours a jobTimezone on the deal over the company default', async () => {
    const { loader } = makeLoader({ '/api/deals/internal/d1': { data: { ...deal, jobTimezone: 'America/Denver' } } });
    expect((await loader.load({ dealId: 'd1' })).timezone).toBe('America/Denver');
    const fallback = makeLoader({}, null);
    expect((await fallback.loader.load({ dealId: 'd1' })).timezone).toBe('America/New_York');
  });

  it('survives peers that are down or answer errors with a partial context', async () => {
    const { loader } = makeLoader({
      '/api/crm/contacts/internal/ct1': { throws: true },
      '/api/deals/job-types/internal': { status: 500 },
      '/api/users/internal/u7': { status: 404 },
    });
    const ctx = await loader.load({ dealId: 'd1' });
    expect(ctx.deal?.dealNumber).toBe('K4T9ZW');
    expect(ctx.deal?.jobTypeName).toBeUndefined();
    expect(ctx.contact).toBeUndefined();
    expect(ctx.technician).toBeUndefined();
    expect(ctx.company?.title).toBe('Acme Property Mgmt');
  });

  it('caches the catalogs across loads', async () => {
    const { loader, calls } = makeLoader();
    await loader.load({ dealId: 'd1' });
    await loader.load({ dealId: 'd1' });
    expect(calls.filter((c) => c.path === '/api/deals/job-types/internal')).toHaveLength(1);
    expect(calls.filter((c) => c.path === '/api/deals/internal/d1')).toHaveLength(2);
  });

  it('lists active custom fields for the short-code picker', async () => {
    const { loader } = makeLoader();
    expect((await loader.listCustomFields()).map((f) => f.name)).toEqual(['Manager Note', 'Choose Company ']);
  });

  it('passes explicit values through', async () => {
    const { loader } = makeLoader();
    expect((await loader.load({ values: { late_value: '15' } })).values).toEqual({ late_value: '15' });
  });
});
