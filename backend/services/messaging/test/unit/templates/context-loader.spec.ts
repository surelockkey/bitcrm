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
      // A client custom field: answered on the contact, never a job's short code.
      { id: 'cf4', name: 'Vendor Number 1', type: 'text', active: true, entityType: 'client' },
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
    // A job is on its own clock: no jobTimezone and no area → Connecticut, never the company setting.
    expect(ctx.timezone).toBe('America/New_York');
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

  describe("the job's own zone (owner, 2026-10-12): jobTimezone, else its service area's, else Connecticut", () => {
    const areas = {
      '/api/deals/service-areas/internal': {
        data: [
          { id: 'sa-ct', name: 'Hartford', timezone: 'America/New_York' },
          { id: 'sa-tx', name: 'Dallas', timezone: 'America/Chicago' },
          { id: 'sa-az', name: 'Phoenix', timezone: 'America/Phoenix' },
        ],
      },
    };

    it("takes the service area's zone when the job carries none", async () => {
      const { loader } = makeLoader(
        { ...areas, '/api/deals/internal/d1': { data: { ...deal, serviceAreaId: 'sa-tx' } } },
        { timezone: 'America/Phoenix' },
      );
      expect((await loader.load({ dealId: 'd1' })).timezone).toBe('America/Chicago');
    });

    it("prefers the job's own jobTimezone and then does not ask for the areas", async () => {
      const { loader, calls } = makeLoader({
        ...areas,
        '/api/deals/internal/d1': { data: { ...deal, serviceAreaId: 'sa-tx', jobTimezone: 'America/Phoenix' } },
      });
      expect((await loader.load({ dealId: 'd1' })).timezone).toBe('America/Phoenix');
      expect(calls.some((c) => c.path === '/api/deals/service-areas/internal')).toBe(false);
    });

    it('falls back to Connecticut — not the company setting — when the areas cannot be read', async () => {
      const { loader } = makeLoader(
        {
          '/api/deals/service-areas/internal': { status: 500 },
          '/api/deals/internal/d1': { data: { ...deal, serviceAreaId: 'sa-tx' } },
        },
        { timezone: 'America/Denver' },
      );
      expect((await loader.load({ dealId: 'd1' })).timezone).toBe('America/New_York');
    });

    it('falls back to Connecticut for an area unknown to deal-service or without a zone', async () => {
      const { loader } = makeLoader({ ...areas, '/api/deals/internal/d1': { data: { ...deal, serviceAreaId: 'sa-gone' } } });
      expect((await loader.load({ dealId: 'd1' })).timezone).toBe('America/New_York');
    });

    it('keeps the company zone for a message with no job', async () => {
      const { loader } = makeLoader(areas, { timezone: 'America/Chicago' });
      expect((await loader.load({ contactId: 'ct1' })).timezone).toBe('America/Chicago');
    });

    it('reads the areas once a minute, not once a text', async () => {
      const { loader, calls } = makeLoader({ ...areas, '/api/deals/internal/d1': { data: { ...deal, serviceAreaId: 'sa-tx' } } });
      await loader.load({ dealId: 'd1' });
      await loader.load({ dealId: 'd1' });
      expect(calls.filter((c) => c.path === '/api/deals/service-areas/internal')).toHaveLength(1);
    });
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

  it('lists active JOB custom fields for the short-code picker', async () => {
    const { loader } = makeLoader();
    expect((await loader.listCustomFields()).map((f) => f.name)).toEqual(['Manager Note', 'Choose Company ']);
  });

  it('passes the call of a phone-trigger automation through untouched', async () => {
    const { loader } = makeLoader();
    const call = { from: '+14045551234', to: '+12034036303', direction: 'inbound' as const, outcome: 'missed' as const };
    expect((await loader.load({ call })).call).toEqual(call);
    expect((await loader.load({ dealId: 'd1' })).call).toBeUndefined();
  });

  it('passes explicit values through', async () => {
    const { loader } = makeLoader();
    expect((await loader.load({ values: { late_value: '15' } })).values).toEqual({ late_value: '15' });
  });

  describe('the client’s confirm link (B12, {{confirm_link}})', () => {
    const DEAL = '3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b';
    const keys = ['PORTAL_BASE_URL', 'APP_PORTAL_DOMAIN', 'PORTAL_TOKEN_SECRET', 'INTERNAL_SERVICE_SECRET'] as const;
    const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};
    beforeEach(() => keys.forEach((k) => (saved[k] = process.env[k])));
    afterEach(() =>
      keys.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))),
    );

    it('puts the job’s signed portal link on the context, computed here — no call to anyone', async () => {
      process.env.PORTAL_BASE_URL = 'https://portal.example.com';
      process.env.INTERNAL_SERVICE_SECRET = 'secret';
      delete process.env.PORTAL_TOKEN_SECRET;
      const { loader, calls } = makeLoader({ [`/api/deals/internal/${DEAL}`]: { data: { ...deal, id: DEAL } } });

      const ctx = await loader.load({ dealId: DEAL });

      expect(ctx.confirmLink).toMatch(/^https:\/\/portal\.example\.com\/confirm\/[A-Za-z0-9_-]{44}$/);
      expect(calls.some((c) => c.path.includes('/billing/'))).toBe(false);
    });

    it('has none without a job, a portal origin or a secret', async () => {
      process.env.INTERNAL_SERVICE_SECRET = 'secret';
      delete process.env.PORTAL_TOKEN_SECRET;
      delete process.env.PORTAL_BASE_URL;
      delete process.env.APP_PORTAL_DOMAIN;
      const { loader } = makeLoader({ [`/api/deals/internal/${DEAL}`]: { data: { ...deal, id: DEAL } } });
      expect((await loader.load({ dealId: DEAL })).confirmLink).toBeUndefined();

      process.env.APP_PORTAL_DOMAIN = 'portal.bitcrm.tech-slk.com';
      expect((await loader.load({ dealId: DEAL })).confirmLink).toMatch(/^https:\/\/portal\.bitcrm\.tech-slk\.com\/confirm\//);
      expect((await loader.load({ contactId: 'ct1' })).confirmLink).toBeUndefined();
    });
  });
});
