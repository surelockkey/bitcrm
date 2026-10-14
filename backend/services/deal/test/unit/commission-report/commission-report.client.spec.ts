import { CommissionReportClient } from 'src/commission-report/commission-report.client';

describe('CommissionReportClient.userNames', () => {
  it('names a technician as Workiz does — the imported Workiz name first, else first and last', async () => {
    const client = new CommissionReportClient();
    const post = jest.fn().mockResolvedValue({
      data: {
        data: [
          { id: 'u1', firstName: 'Ricky', lastName: 'Sledge', workizName: '(2) TX - Ricky Sledge' },
          { id: 'u2', firstName: 'Tom', lastName: 'Tech' },
          { id: 'u3', firstName: 'Ann', lastName: 'Lee', workizName: '  ' },
        ],
      },
    });
    (client as unknown as { user: { post: jest.Mock } }).user = { post };
    const names = await client.userNames(['u1', 'u2', 'u3']);
    expect(post).toHaveBeenCalledWith('/api/users/internal/names-by-ids', { userIds: ['u1', 'u2', 'u3'] });
    expect([...names.entries()]).toEqual([
      ['u1', '(2) TX - Ricky Sledge'],
      ['u2', 'Tom Tech'],
      ['u3', 'Ann Lee'],
    ]);
  });
});

/**
 * Billing answers 100 ledgers a body. A long period's jobs done here are
 * several bodies — sent up to four at a time, never one after another, and
 * one failed body still makes the whole lookup `null` (the report says so).
 */
describe('CommissionReportClient.ledgers — chunks in parallel', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `d${i}`);

  function withBilling(post: jest.Mock): CommissionReportClient {
    const client = new CommissionReportClient();
    (client as unknown as { billing: { post: jest.Mock } }).billing = { post };
    return client;
  }

  it('keeps at most four bodies in flight and reads every chunk', async () => {
    let inFlight = 0;
    let peak = 0;
    const post = jest.fn(async (_url: string, body: { dealIds: string[] }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: { data: Object.fromEntries(body.dealIds.map((id) => [id, [{ id: `p-${id}` }]])) } };
    });
    const out = await withBilling(post).ledgers(ids(950));
    expect(post).toHaveBeenCalledTimes(10);
    expect(post.mock.calls.every(([, b]) => b.dealIds.length <= 100)).toBe(true);
    expect(peak).toBe(4);
    expect(out?.size).toBe(950);
  });

  it('one failed chunk makes the lookup null', async () => {
    const post = jest
      .fn()
      .mockResolvedValueOnce({ data: { data: {} } })
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue({ data: { data: {} } });
    expect(await withBilling(post).ledgers(ids(300))).toBeNull();
  });
});

describe('CommissionReportClient.commissionHistories — chunks in parallel', () => {
  it('sends 200-id bodies up to four at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const post = jest.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { data: { data: {} } };
    });
    const client = new CommissionReportClient();
    (client as unknown as { user: { post: jest.Mock } }).user = { post };
    await client.commissionHistories(Array.from({ length: 1000 }, (_, i) => `u${i}`));
    expect(post).toHaveBeenCalledTimes(5);
    expect(peak).toBe(4);
  });
});
