import { toReportDeal } from 'src/deals/report/jobs-report.logic';
import { summarizeJobsReport } from 'src/deals/report/jobs-report.summary';

const row = (id: string, over: Record<string, unknown>) =>
  toReportDeal({
    id,
    status: 'active',
    dealNumber: id.toUpperCase(),
    contactId: 'c',
    createdAt: '2026-09-10T15:00:00.000Z',
    scheduledDate: '2026-09-12',
    scheduledEndDate: '2026-09-12',
    scheduledTimeSlot: '10:00-11:00',
    superStatus: 'done',
    totals: { total: 100.1, amountDue: 10 },
    ...over,
  });

describe('summarizeJobsReport — the figures Workiz was checked on', () => {
  const deals = [
    row('a', {}),
    row('b', { superStatus: 'canceled', totals: { total: 0 } }),
    row('c', { superStatus: 'pending', totals: { total: 243.51, amountDue: 243.51 } }),
    // Created 23:30 Eastern on the 27th (03:30 UTC on the 28th): in, by created.
    row('d', { createdAt: '2026-09-28T03:30:00.000Z', scheduledDate: '2026-09-30', scheduledEndDate: '2026-09-30' }),
    // Starts in the window, ends after it.
    row('e', { scheduledDate: '2026-09-27', scheduledEndDate: '2026-09-29', converted: true }),
    // A Workiz estimate stub — never on the report.
    row('f', { isStub: true }),
  ];

  it('counts rows and sums the money in cents, Done apart', () => {
    const s = summarizeJobsReport(deals, 'end', '2026-09-01', '2026-09-27');
    expect(s.ids).toEqual(['a', 'b', 'c']);
    expect(s.rows).toBe(3);
    expect(s.total).toBe(343.61);
    expect(s.doneTotal).toBe(100.1);
    expect(s.amountDue).toBe(253.51);
    expect(s.byStatus).toMatchObject({ done: 1, canceled: 1, pending: 1 });
  });

  it('windows each By on its own date', () => {
    expect(summarizeJobsReport(deals, 'created', '2026-09-01', '2026-09-27').ids).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(summarizeJobsReport(deals, 'scheduled', '2026-09-01', '2026-09-27').ids).toEqual(['a', 'b', 'c', 'e']);
    expect(summarizeJobsReport(deals, 'end', '2026-09-28', '2026-09-30').ids).toEqual(['d', 'e']);
  });

  it('applies the report filters and counts the job origin', () => {
    const s = summarizeJobsReport(deals, 'scheduled', '2026-09-01', '2026-09-27', { status: ['done'] });
    expect(s.ids).toEqual(['a', 'e']);
    expect(s.origin).toEqual({ lead: 1, new: 1 });
  });
});
