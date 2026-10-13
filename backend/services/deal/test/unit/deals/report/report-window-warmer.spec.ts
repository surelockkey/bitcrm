import { ReportWindowWarmer, settledPeriods } from 'src/deals/report/report-window-warmer';

/**
 * Нічний прогрів вікон звітів: лише ЗАКРИТІ періоди (минулий тиждень, минулий
 * місяць) — вікно з «сьогодні» живе в кеші п'ять хвилин, гріти його о третій
 * ночі марно. Один за одним, і падіння одного не зупиняє решту.
 */
describe('ReportWindowWarmer', () => {
  // Tuesday Oct 13 2026, 03:00 in New York.
  const now = new Date('2026-10-13T07:00:00.000Z');

  it('settledPeriods: last Monday–Sunday week and last calendar month, on the New York calendar', () => {
    expect(settledPeriods(now)).toEqual({
      lastWeek: { from: '2026-10-05', to: '2026-10-11' },
      lastMonth: { from: '2026-09-01', to: '2026-09-30' },
    });
    // On a Monday, last week ended yesterday; in January, last month is December.
    expect(settledPeriods(new Date('2027-01-04T08:00:00.000Z'))).toEqual({
      lastWeek: { from: '2026-12-28', to: '2027-01-03' },
      lastMonth: { from: '2026-12-01', to: '2026-12-31' },
    });
  });

  function make() {
    const jobs = { warmWindow: jest.fn(async (): Promise<void> => undefined), defaultBy: jest.fn(async () => 'end') };
    const stats = { warmWindow: jest.fn(async (): Promise<void> => undefined) };
    const tax = { warmWindow: jest.fn(async () => undefined) };
    const commissions = { warmPeriod: jest.fn(async () => undefined) };
    const warmer = new ReportWindowWarmer(jobs as never, stats as never, tax as never, commissions as never);
    return { warmer, jobs, stats, tax, commissions };
  }

  it('warms what each report opens the office’s settled periods on', async () => {
    const { warmer, jobs, stats, tax, commissions } = make();

    const out = await warmer.warm(now);

    const week = ['2026-10-05', '2026-10-11'];
    const month = ['2026-09-01', '2026-09-30'];
    expect(jobs.warmWindow.mock.calls).toEqual([['end', ...week], ['end', ...month]]);
    expect(stats.warmWindow.mock.calls).toEqual([['end', ...week], ['end', ...month]]);
    expect(tax.warmWindow.mock.calls).toEqual([['end', ...month]]);
    expect(commissions.warmPeriod.mock.calls).toEqual([['closed', ...week], ['closed', ...month]]);
    expect(out).toEqual({ warmed: 7, failed: 0 });
  });

  it('one at a time — a quarter of jobs is not read four ways at once', async () => {
    const { warmer, jobs, stats } = make();
    let inFlight = 0;
    let peak = 0;
    const slow = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    };
    jobs.warmWindow.mockImplementation(slow);
    stats.warmWindow.mockImplementation(slow);
    await warmer.warm(now);
    expect(peak).toBe(1);
  });

  it('a window that fails is counted and the rest still warm', async () => {
    const { warmer, stats, tax } = make();
    stats.warmWindow.mockRejectedValueOnce(new Error('throttled'));
    const out = await warmer.warm(now);
    expect(out).toEqual({ warmed: 6, failed: 1 });
    expect(tax.warmWindow).toHaveBeenCalled();
  });
});
