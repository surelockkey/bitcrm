import { ContactLookupService } from '../../src/common/contact-lookup.service';

/**
 * The cache in front of the CRM. The interesting case is a *miss*: an unknown
 * caller becomes a client the moment someone clicks "Add client" on that very
 * call. A miss is kept five minutes (shared through Redis), and contact-events
 * drop the new client's numbers at once (`forgetContact`, see
 * redis-batch-cache.spec) — so the expiry is only the backstop.
 */
describe('ContactLookupService', () => {
  const jane = { kind: 'contact', id: 'c1', firstName: 'Jane', lastName: 'Roe' };

  function mockCrm(data: Record<string, unknown>) {
    return jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data }),
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /** What a masked call dials — the numbers and what to press on each. */
  it('reads a client’s numbers with their extensions', async () => {
    global.fetch = mockCrm({
      id: 'c1',
      firstName: 'Jane',
      lastName: 'Roe',
      phones: ['+14045551234', '+14045555678'],
      phoneExtensions: { '+14045555678': '102' },
    }) as never;
    const service = new ContactLookupService();

    const out = await service.phonesOf('c1');

    expect(out).toEqual({
      phones: ['+14045551234', '+14045555678'],
      name: 'Jane Roe',
      extensions: { '+14045555678': '102' },
    });
  });

  it('resolves a number to a contact and names it', async () => {
    global.fetch = mockCrm({ '+14045551234': jane }) as never;
    const service = new ContactLookupService();

    const out = await service.resolve(['+14045551234']);

    expect(out['+14045551234']).toEqual({
      kind: 'contact',
      id: 'c1',
      name: 'Jane Roe',
      companyId: undefined,
    });
  });

  it('asks the CRM once for a hit, then serves it from cache', async () => {
    const fetchMock = mockCrm({ '+14045551234': jane });
    global.fetch = fetchMock as never;
    const service = new ContactLookupService();

    await service.resolve(['+14045551234']);
    await service.resolve(['+14045551234']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-asks once a miss expires, so a new client shows up', async () => {
    jest.useFakeTimers();
    const fetchMock = mockCrm({}); // nobody owns this number yet
    global.fetch = fetchMock as never;
    const service = new ContactLookupService();

    await service.resolve(['+14045551234']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Immediately after, the miss is still cached — one page render must not
    // fan out one request per row.
    await service.resolve(['+14045551234']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The client gets created; past the miss window a refresh has to see them.
    jest.advanceTimersByTime(5 * 60_000 + 1_000);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { '+14045551234': jane } }),
    });

    const out = await service.resolve(['+14045551234']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out['+14045551234']?.name).toBe('Jane Roe');
  });

  it('holds a hit far longer than a miss', async () => {
    jest.useFakeTimers();
    const fetchMock = mockCrm({ '+14045551234': jane });
    global.fetch = fetchMock as never;
    const service = new ContactLookupService();

    await service.resolve(['+14045551234']);
    jest.advanceTimersByTime(5 * 60_000 + 1_000); // past the miss window, inside the hit one
    await service.resolve(['+14045551234']);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never asks about non-numbers', async () => {
    const fetchMock = mockCrm({});
    global.fetch = fetchMock as never;
    const service = new ContactLookupService();

    const out = await service.resolve(['client:abc-123', '']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(out).toEqual({});
  });

  it('degrades to unnamed rather than throwing when the CRM is down', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as never;
    const service = new ContactLookupService();

    await expect(service.resolve(['+14045551234'])).resolves.toEqual({});
  });

  it("doesn't cache a failed lookup as a miss", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { '+14045551234': jane } }),
      });
    global.fetch = fetchMock as never;
    const service = new ContactLookupService();

    await service.resolve(['+14045551234']);
    const out = await service.resolve(['+14045551234']);

    expect(out['+14045551234']?.name).toBe('Jane Roe');
  });
});
