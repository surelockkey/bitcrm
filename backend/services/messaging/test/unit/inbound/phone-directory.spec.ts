import { PhoneDirectory } from '../../../src/inbound/phone-directory';

const PHONE = '+14045551234';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function makeDirectory(fetchMock: jest.Mock) {
  return new PhoneDirectory({
    crmServiceUrl: 'http://crm:4002',
    userServiceUrl: 'http://user:4001',
    internalSecret: 's3cret',
    fetch: fetchMock as unknown as typeof fetch,
  });
}

describe('PhoneDirectory', () => {
  it('asks user-service by-phones with the internal secret and maps a hit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, { success: true, data: { [PHONE]: { id: 'u1', firstName: 'Ann', lastName: 'Lee', roleId: 'r1' } } }),
    );
    const found = await makeDirectory(fetchMock).lookupUser(PHONE);

    expect(found).toEqual({ id: 'u1', name: 'Ann Lee', roleId: 'r1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://user:4001/api/users/internal/by-phones');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-internal-secret': 's3cret' });
    expect(JSON.parse(init.body)).toEqual({ phones: [PHONE] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('asks crm by-phones and keeps the kind (contact or company)', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { data: { [PHONE]: { kind: 'company', id: 'co1', firstName: 'Acme' } } }))
      .mockResolvedValueOnce(jsonResponse(200, { data: { [PHONE]: { id: 'ct1' } } }));
    const directory = makeDirectory(fetchMock);

    expect(await directory.lookupContact(PHONE)).toEqual({ kind: 'company', id: 'co1', name: 'Acme', companyId: undefined });
    expect(await directory.lookupContact(PHONE)).toEqual({ kind: 'contact', id: 'ct1', name: undefined, companyId: undefined });
    expect(fetchMock.mock.calls[0][0]).toBe('http://crm:4002/api/crm/contacts/internal/by-phones');
  });

  it('answers null on a definite miss', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(200, { data: {} }));
    const directory = makeDirectory(fetchMock);
    expect(await directory.lookupUser(PHONE)).toBeNull();
    expect(await directory.lookupContact(PHONE)).toBeNull();
  });

  it('answers "unreachable" on a non-2xx or a network failure, never throws', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const directory = makeDirectory(fetchMock);
    expect(await directory.lookupUser(PHONE)).toBe('unreachable');
    expect(await directory.lookupContact(PHONE)).toBe('unreachable');
  });
});
