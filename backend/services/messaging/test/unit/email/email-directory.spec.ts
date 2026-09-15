import { EmailDirectory } from '../../../src/email/inbound/email-directory';

const EMAIL = 'jane@example.com';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function make(fetchMock: jest.Mock) {
  return new EmailDirectory({ crmServiceUrl: 'http://crm:4002', internalSecret: 's3cret', fetch: fetchMock as unknown as typeof fetch, unsupportedTtlMs: 60_000 });
}

describe('EmailDirectory', () => {
  it('asks crm by-emails with the internal secret and maps a hit', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, { data: { [EMAIL]: { kind: 'contact', id: 'ct1', firstName: 'Jane', lastName: 'Doe', companyId: 'co1' } } }),
    );
    expect(await make(fetchMock).lookupContact(EMAIL)).toEqual({ kind: 'contact', id: 'ct1', name: 'Jane Doe', companyId: 'co1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://crm:4002/api/crm/contacts/internal/by-emails');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-internal-secret': 's3cret' });
    expect(JSON.parse(init.body)).toEqual({ emails: [EMAIL] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers null on a definite miss and defaults the kind to contact', async () => {
    const directory = make(jest.fn().mockResolvedValueOnce(jsonResponse(200, { data: {} })).mockResolvedValueOnce(jsonResponse(200, { data: { [EMAIL]: { id: 'ct2' } } })));
    expect(await directory.lookupContact(EMAIL)).toBeNull();
    expect(await directory.lookupContact(EMAIL)).toEqual({ kind: 'contact', id: 'ct2', name: undefined, companyId: undefined });
  });

  it('remembers a 404 (crm has no such route) and stops asking for a while', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse(404, {}));
    const directory = make(fetchMock);
    expect(directory.routeUnsupported).toBe(false);
    expect(await directory.lookupContact(EMAIL)).toBeNull();
    expect(directory.routeUnsupported).toBe(true);
    expect(await directory.lookupContact('other@example.com')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('answers "unreachable" on a 5xx or a network failure, never throws', async () => {
    const directory = make(jest.fn().mockResolvedValueOnce(jsonResponse(503, {})).mockRejectedValueOnce(new Error('ECONNREFUSED')));
    expect(await directory.lookupContact(EMAIL)).toBe('unreachable');
    expect(await directory.lookupContact(EMAIL)).toBe('unreachable');
    expect(directory.routeUnsupported).toBe(false);
  });
});
