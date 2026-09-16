import { CrmContactsClient } from '../../../src/outbound/internal/crm-contacts.client';
import { DealContextClient } from '../../../src/outbound/internal/deal-context.client';
import { OWNED_NUMBERS_TTL_MS, TelephonyNumbersClient } from '../../../src/outbound/internal/telephony-numbers.client';

/** A `fetch` that answers from a script of `{ status, body }` (or throws). */
function fakeFetch(script: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let i = 0;
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = script[i++] ?? { status: 200, body: { data: [] } };
    if (next instanceof Error) throw next;
    return { ok: next.status < 400, status: next.status, json: async () => next.body } as unknown as Response;
  });
  return { fetchImpl, calls };
}

const NUMBER = { phoneNumber: '+14045550001', sid: 'PN1', capabilities: { sms: true, mms: true, voice: true }, messagingServiceSid: 'MG1' };

describe('TelephonyNumbersClient', () => {
  it('reads the internal owned listing with the service secret and caches it for 60 s', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { data: [NUMBER] } }]);
    const client = new TelephonyNumbersClient(fetchImpl);

    expect(await client.listOwned(1_000)).toEqual([NUMBER]);
    expect(calls[0].url).toMatch(/\/api\/telephony\/numbers\/internal\/owned$/);
    expect((calls[0].init?.headers as Record<string, string>)['x-internal-secret']).toBeDefined();

    expect(await client.listOwned(1_000 + OWNED_NUMBERS_TTL_MS - 1)).toEqual([NUMBER]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.listOwned(1_000 + OWNED_NUMBERS_TTL_MS + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('serves the stale list on an error and an empty list before the first success', async () => {
    const { fetchImpl } = fakeFetch([
      new Error('ECONNREFUSED'),
      { status: 200, body: { data: [NUMBER] } },
      { status: 503 },
      { status: 503 },
    ]);
    const client = new TelephonyNumbersClient(fetchImpl);
    expect(await client.listOwned(0)).toEqual([]); // nothing cached yet
    expect(await client.listOwned(0)).toEqual([NUMBER]);
    expect(await client.listOwned(OWNED_NUMBERS_TTL_MS + 1)).toEqual([NUMBER]); // 503 → stale answer
    client.forget();
    expect(await client.listOwned(0)).toEqual([]); // forgotten and still failing → unknown
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
});

describe('DealContextClient', () => {
  it('reads a deal, caches it and remembers a 404', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { data: { id: 'd1', contactId: 'ct1', serviceAreaId: 'sa1', sourceId: 'src1', assignedTechIds: ['u1'] } } },
      { status: 404 },
    ]);
    const client = new DealContextClient(fetchImpl);
    expect(await client.find('d1', 0)).toEqual({ id: 'd1', contactId: 'ct1', serviceAreaId: 'sa1', sourceId: 'src1', assignedTechIds: ['u1'], assignedDispatcherId: undefined });
    expect(calls[0].url).toMatch(/\/api\/deals\/internal\/d1$/);
    expect(await client.find('d1', 0)).toMatchObject({ id: 'd1' });
    expect(await client.find('missing', 0)).toBeNull();
    expect(await client.find('missing', 0)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await client.find(undefined)).toBeNull();
  });

  it('answers null (not an exception) when deal-service is down', async () => {
    const client = new DealContextClient(fakeFetch([new Error('timeout')]).fetchImpl);
    expect(await client.find('d1')).toBeNull();
  });

  it('maps a service area to its caller id from the internal catalog', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { data: [{ id: 'sa1', name: 'Atlanta', active: true, callerId: '+14045550009' }, { id: 'sa2', name: 'Macon', active: true }] } },
    ]);
    const client = new DealContextClient(fetchImpl);
    expect(await client.serviceAreaCallerId('sa1', 0)).toBe('+14045550009');
    expect(await client.serviceAreaCallerId('sa2', 0)).toBeUndefined();
    expect(await client.serviceAreaCallerId('nope', 0)).toBeUndefined();
    expect(await client.serviceAreaCallerId(undefined)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('CrmContactsClient', () => {
  it('reads a contact with its addresses, lower-casing emails', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { data: { id: 'ct1', phones: ['+14045551234'], emails: ['A@B.co'] } } }, { status: 404 }]);
    const client = new CrmContactsClient(fetchImpl);
    expect(await client.getContact('ct1')).toEqual({ id: 'ct1', phones: ['+14045551234'], emails: ['a@b.co'] });
    expect(calls[0].url).toMatch(/\/api\/crm\/contacts\/internal\/ct1$/);
    expect(await client.getContact('ct2')).toBeNull();
  });

  it('resolves the owner of a number through internal/by-phones', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { data: { '+14045551234': { kind: 'company', id: 'co1' } } } },
      { status: 200, body: { data: {} } },
      new Error('down'),
    ]);
    const client = new CrmContactsClient(fetchImpl);
    expect(await client.findByPhone('+14045551234')).toEqual({ kind: 'company', id: 'co1' });
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ phones: ['+14045551234'] });
    expect(await client.findByPhone('+14045550000')).toBeNull();
    expect(await client.findByPhone('+14045550000')).toBeNull();
  });
});
