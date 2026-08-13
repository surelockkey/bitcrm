import { ContactLookupService } from '../../src/common/contact-lookup.service';

/**
 * The cache in front of the CRM. The interesting case is a *miss*: an unknown
 * caller becomes a client the moment someone clicks "Add client" on that very
 * call, so a miss must not be remembered for long or the feature looks broken.
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

  it('re-asks soon after a miss, so a new client shows up', async () => {
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

    // The client gets created; a refresh a moment later has to see them.
    jest.advanceTimersByTime(21_000);
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
    jest.advanceTimersByTime(21_000); // past the miss window, inside the hit one
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
