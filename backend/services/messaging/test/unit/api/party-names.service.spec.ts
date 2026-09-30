import { PartyNamesService } from '../../../src/api/access/party-names.service';
import { createMockConversation } from '../mocks';
import { adminPerms } from './api-mocks';

/**
 * The names a page of the inbox refers to, sent with that page — so the
 * list paints the names on its first frame instead of the numbers, which the
 * browser used to show until three more round trips came back.
 */
type Call = { url: string; body: unknown };

function json(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({ success: true, data }) } as Response;
}

function make(answer: (url: string, body: unknown) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    return answer(url, body);
  });
  return { svc: new PartyNamesService(fetchImpl), calls, fetchImpl };
}

const contactThread = createMockConversation({ id: 'c1', kind: 'client', partyKind: 'contact', partyId: 'ct1' });
const companyThread = createMockConversation({ id: 'c2', kind: 'client', partyKind: 'company', partyId: 'co1' });
const teamThread = createMockConversation({ id: 'c3', kind: 'team', partyKind: 'user', partyId: 'u1' });
const unknownThread = createMockConversation({ id: 'c4', kind: 'unknown', partyKind: 'none', partyId: undefined });

const withCompanies = () =>
  adminPerms({ permissions: { ...adminPerms().permissions, companies: { view: true } } });

const crmAnswer = {
  'contact:ct1': { kind: 'contact', id: 'ct1', name: 'Jane Smith' },
  'company:co1': { kind: 'company', id: 'co1', name: 'Acme Locks' },
};
const usersAnswer = [{ id: 'u1', firstName: 'Bob', lastName: 'Ray', email: 'bob@x.com' }];

function peers(url: string) {
  if (url.includes('/api/crm/contacts/internal/by-ids')) return json(crmAnswer);
  if (url.includes('/api/users/internal/names-by-ids')) return json(usersAnswer);
  return json(null, 404);
}

describe('PartyNamesService.forPage', () => {
  it('names the contacts, companies and teammates of a page — names only', async () => {
    const { svc } = make(peers);

    const included = await svc.forPage([contactThread, companyThread, teamThread, unknownThread], withCompanies());

    expect(included).toEqual({
      contacts: [{ id: 'ct1', name: 'Jane Smith' }],
      companies: [{ id: 'co1', name: 'Acme Locks' }],
      users: [{ id: 'u1', name: 'Bob Ray' }],
    });
  });

  it('asks crm once for contacts and companies together, and user-service once, in parallel', async () => {
    let inFlight = 0;
    let peak = 0;
    const { svc, calls } = make(async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return peers(url);
    });

    await svc.forPage([contactThread, companyThread, teamThread], withCompanies());

    const crm = calls.filter((c) => c.url.includes('/api/crm/'));
    const users = calls.filter((c) => c.url.includes('/api/users/'));
    expect(crm).toHaveLength(1);
    expect(crm[0].body).toEqual({ refs: [{ kind: 'contact', id: 'ct1' }, { kind: 'company', id: 'co1' }] });
    expect(users).toHaveLength(1);
    expect(users[0].body).toEqual({ userIds: ['u1'] });
    expect(peak).toBe(2);
  });

  it('asks each id once, however many threads carry it', async () => {
    const { svc, calls } = make(peers);
    const again = createMockConversation({ id: 'c9', kind: 'client', partyKind: 'contact', partyId: 'ct1' });

    await svc.forPage([contactThread, again], adminPerms());

    expect(calls.find((c) => c.url.includes('/api/crm/'))?.body).toEqual({ refs: [{ kind: 'contact', id: 'ct1' }] });
  });

  // The inbox shows a client's name only to who may see the client today;
  // the side-load changes when the name arrives, not who gets it.
  it('leaves out the contacts for a viewer without contacts.view', async () => {
    const { svc, calls } = make(peers);
    const perms = adminPerms({ permissions: { ...adminPerms().permissions, contacts: { view: false } } });

    const included = await svc.forPage([contactThread, teamThread], perms);

    expect(included.contacts).toEqual([]);
    expect(included.users).toEqual([{ id: 'u1', name: 'Bob Ray' }]);
    expect(calls.some((c) => c.url.includes('/api/crm/'))).toBe(false);
  });

  it('leaves out the companies for a viewer without companies.view', async () => {
    const { svc, calls } = make(peers);

    const included = await svc.forPage([contactThread, companyThread], adminPerms());

    expect(included.companies).toEqual([]);
    expect(calls.find((c) => c.url.includes('/api/crm/'))?.body).toEqual({ refs: [{ kind: 'contact', id: 'ct1' }] });
  });

  it('makes no call at all for a page that names nobody', async () => {
    const { svc, fetchImpl } = make(peers);

    expect(await svc.forPage([unknownThread], adminPerms())).toEqual({ contacts: [], companies: [], users: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Best effort: the list renders without the names, so a peer that is down,
  // slow or answering nonsense costs that part of the side-load, never the page.
  it('drops only the part whose peer failed', async () => {
    const { svc } = make((url) => {
      if (url.includes('/api/crm/')) throw new Error('ECONNREFUSED');
      return peers(url);
    });

    const included = await svc.forPage([contactThread, teamThread], adminPerms());

    expect(included).toEqual({ contacts: [], companies: [], users: [{ id: 'u1', name: 'Bob Ray' }] });
  });

  it('treats a non-200 or a malformed body as no names', async () => {
    const { svc } = make((url) => (url.includes('/api/crm/') ? json(null, 500) : json({ nope: true })));

    expect(await svc.forPage([contactThread, teamThread], adminPerms())).toEqual({
      contacts: [],
      companies: [],
      users: [],
    });
  });

  it('gives each request a deadline', async () => {
    const { svc, fetchImpl } = make(peers);

    await svc.forPage([contactThread, teamThread], adminPerms());

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchImpl.mock.calls) expect((init as RequestInit).signal).toBeDefined();
  });

  it('skips a person with no name rather than sending an empty one', async () => {
    const { svc } = make((url) =>
      url.includes('/api/crm/')
        ? json({ 'contact:ct1': { kind: 'contact', id: 'ct1', name: '' } })
        : json([{ id: 'u1', firstName: '', lastName: '' }]),
    );

    expect(await svc.forPage([contactThread, teamThread], adminPerms())).toEqual({
      contacts: [],
      companies: [],
      users: [],
    });
  });
});
