import {
  jobsOfTech,
  keptJobs,
  shareToDollars,
  sortJobs,
  techAllowed,
  tipsByTech,
  toTechRow,
  toTipsDeal,
  type TipsDeal,
} from 'src/deals/report/tips-report.logic';

/** A deal row as the window read projects it. Job date 2026-09-12 10:00 in the account's zone. */
const item = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  status: 'active',
  dealNumber: id.toUpperCase(),
  contactId: `c-${id}`,
  jobTypeId: 'jt1',
  createdAt: '2026-09-10T15:00:00.000Z',
  scheduledDate: '2026-09-12',
  scheduledEndDate: '2026-09-12',
  scheduledTimeSlot: '10:00-11:00',
  superStatus: 'done',
  assignedTechIds: ['t1'],
  totals: { total: 100 },
  ...over,
});

const deals = (...items: Record<string, unknown>[]): TipsDeal[] => items.map(toTipsDeal);
const noNames = { jobTypes: new Map<string, string>(), clients: new Map<string, string>() };

describe('Tips report logic', () => {
  describe('toTipsDeal', () => {
    it('takes the tip of an imported job — tipAmount first, then totals.tip — in cents', () => {
      expect(toTipsDeal(item('a', { tipAmount: 64.61 })).tipCents).toBe(6461);
      expect(toTipsDeal(item('b', { totals: { total: 10, tip: 5.1 } })).tipCents).toBe(510);
      expect(toTipsDeal(item('c', { tipAmount: 12, totals: { total: 10, tip: 99 } })).tipCents).toBe(1200);
    });

    it('a job created here has no tip (BitCRM does not take tips yet)', () => {
      expect(toTipsDeal(item('a')).tipCents).toBe(0);
    });
  });

  describe('keptJobs — Workiz: job date in the period, any status, someone assigned', () => {
    it('keeps Canceled jobs and jobs without a tip, drops unassigned jobs and stubs', () => {
      const kept = keptJobs(
        deals(
          item('done', { tipAmount: 10 }),
          item('canceled', { superStatus: 'canceled' }),
          item('pending', { superStatus: 'pending' }),
          item('nobody', { assignedTechIds: [] }),
          item('stub', { isStub: true }),
        ),
        '2026-09-01',
        '2026-09-27',
        {},
      );
      expect(kept.map((d) => d.id)).toEqual(['done', 'canceled', 'pending']);
    });

    it('is on the job date on the account clock (an imported job keeps Workiz\'s instant)', () => {
      const kept = keptJobs(
        deals(
          // 23:30 in Dallas on the 27th is 00:30 on the 28th Eastern — Workiz reports it on the 28th.
          item('late', {
            scheduledDate: '2026-09-27',
            scheduledEndDate: '2026-09-27',
            scheduledTimeSlot: '23:30-23:45',
            jobDateUtc: '2026-09-28T04:30:00.000Z',
            jobEndDateUtc: '2026-09-28T04:45:00.000Z',
            jobTimezone: 'America/Chicago',
          }),
          item('in', { scheduledDate: '2026-09-27', scheduledEndDate: '2026-09-27' }),
          // Created in the period, but the visit is later: the created date does not count.
          item('later', { createdAt: '2026-09-05T15:00:00.000Z', scheduledDate: '2026-10-02', scheduledEndDate: '2026-10-02' }),
        ),
        '2026-09-01',
        '2026-09-27',
        {},
      );
      expect(kept.map((d) => d.id)).toEqual(['in']);
    });

    it('Job type and Client narrow the jobs; Tech does not (it picks rows)', () => {
      const all = deals(item('a', { jobTypeId: 'jt1' }), item('b', { jobTypeId: 'jt2', contactId: 'c9' }), item('c', { jobTypeId: 'jt2' }));
      expect(keptJobs(all, '2026-09-01', '2026-09-30', { jobTypeId: ['jt2'] }).map((d) => d.id)).toEqual(['b', 'c']);
      expect(keptJobs(all, '2026-09-01', '2026-09-30', { jobTypeId: ['jt2'], contactId: ['c9'] }).map((d) => d.id)).toEqual(['b']);
      expect(keptJobs(all, '2026-09-01', '2026-09-30', { techId: ['nobody'] })).toHaveLength(3);
    });
  });

  describe('tipsByTech — the tip split equally between everyone on the job', () => {
    it('Workiz 2025-07-11: $64.61 on two people is $32.305 each, printed $32.31; each counts the job once', () => {
      const jobs = deals(
        item('JL3D1I', { tipAmount: 64.61, assignedTechIds: ['t1', 't2'] }),
        item('ZI22TS', { assignedTechIds: ['t1'] }),
      );
      const rows = tipsByTech(jobs, {});
      const t1 = rows.find((r) => r.techId === 't1')!;
      const t2 = rows.find((r) => r.techId === 't2')!;
      expect(t1).toEqual({ techId: 't1', tipCents: 3230.5, jobs: 2 });
      expect(t2).toEqual({ techId: 't2', tipCents: 3230.5, jobs: 1 });
      expect(toTechRow(t1, 'Sam', true)).toEqual({ techId: 't1', name: 'Sam', tips: 32.31, jobs: 2 });
    });

    it('sums the unrounded shares and rounds once: two half cents make a whole one', () => {
      const rows = tipsByTech(deals(item('a', { tipAmount: 0.01, assignedTechIds: ['t1', 't2'] }), item('b', { tipAmount: 0.01, assignedTechIds: ['t1', 't3'] })), {});
      expect(shareToDollars(rows.find((r) => r.techId === 't1')!.tipCents)).toBe(0.01);
      expect(shareToDollars(rows.find((r) => r.techId === 't2')!.tipCents)).toBe(0.01);
    });

    it('thirds come back whole', () => {
      const rows = tipsByTech(deals(item('a', { tipAmount: 10, assignedTechIds: ['t1', 't2', 't3'] })), {});
      expect(rows.map((r) => shareToDollars(r.tipCents))).toEqual([3.33, 3.33, 3.33]);
      const three = tipsByTech(deals(...['a', 'b', 'c'].map((id) => item(id, { tipAmount: 10, assignedTechIds: ['t1', 't2', 't3'] }))), {});
      expect(shareToDollars(three[0].tipCents)).toBe(10);
    });

    it('a person assigned twice to the same job is one of its people, not two', () => {
      const rows = tipsByTech(deals(item('a', { tipAmount: 10, assignedTechIds: ['t1', 't1', 't2'] })), {});
      expect(rows).toEqual([
        { techId: 't1', tipCents: 500, jobs: 1 },
        { techId: 't2', tipCents: 500, jobs: 1 },
      ]);
    });

    it('lists a person with jobs but no tips', () => {
      expect(tipsByTech(deals(item('a', { superStatus: 'canceled' })), {})).toEqual([{ techId: 't1', tipCents: 0, jobs: 1 }]);
    });

    it('the Tech filter keeps its rows — the others\' shares are still split by everyone on the job', () => {
      const rows = tipsByTech(deals(item('a', { tipAmount: 10, assignedTechIds: ['t1', 't2'] })), { techId: ['t2'] });
      expect(rows).toEqual([{ techId: 't2', tipCents: 500, jobs: 1 }]);
    });

    it('assigned_only: only their own line', () => {
      const rows = tipsByTech(deals(item('a', { tipAmount: 10, assignedTechIds: ['t1', 'me'] })), {}, 'me');
      expect(rows).toEqual([{ techId: 'me', tipCents: 500, jobs: 1 }]);
      expect(techAllowed('t1', {}, 'me')).toBe(false);
      expect(techAllowed('me', { techId: ['t1'] }, 'me')).toBe(false);
    });

    it('withholds the money without financials.view, keeps the count', () => {
      expect(toTechRow({ techId: 't1', tipCents: 100, jobs: 3 }, 'Sam', false)).toEqual({ techId: 't1', name: 'Sam', tips: null, jobs: 3 });
    });
  });

  describe('jobsOfTech and sortJobs — the row opened', () => {
    const jobs = deals(
      item('a', { dealNumber: 'PS5CTO', jobSerial: 363198, tipAmount: 64.61, assignedTechIds: ['t1', 't2'], totals: { total: 641.63 }, jobTypeId: 'jt1' }),
      item('b', { dealNumber: 'HGR6P4', jobSerial: 370133, totals: { total: 147.87 }, jobTypeId: 'jt2', scheduledDate: '2026-09-03', scheduledEndDate: '2026-09-03' }),
      // Created in BitCRM: no serial, newer than every imported job.
      item('c', { dealNumber: '1001', createdAt: '2026-09-20T15:00:00.000Z', totals: { total: 50 }, tipAmount: 5 }),
      item('d', { dealNumber: 'OTHER', assignedTechIds: ['t9'] }),
    );
    const lk = { jobTypes: new Map([['jt1', 'Car Key Copy'], ['jt2', 'Lockout']]), clients: new Map([['c-a', 'Carin'], ['c-b', 'Michael']]) };

    it('lists the person\'s jobs with the whole total and their share of the tip', () => {
      const rows = jobsOfTech(jobs, 't1', lk, true);
      expect(rows.map((r) => r.jobNumber)).toEqual(['PS5CTO', 'HGR6P4', '1001']);
      expect(rows[0]).toMatchObject({ client: 'Carin', jobType: 'Car Key Copy', total: 641.63, tip: 32.31, people: 2, date: '2026-09-12T10:00' });
      expect(jobsOfTech(jobs, 't1', noNames, false)[0]).toMatchObject({ total: null, tip: null });
    });

    it('default order: Workiz serial, then jobs created here by creation', () => {
      const rows = jobsOfTech(jobs, 't1', lk, true);
      expect(sortJobs([...rows].reverse(), jobs, 'default', 'asc').map((r) => r.jobNumber)).toEqual(['PS5CTO', 'HGR6P4', '1001']);
      expect(sortJobs(rows, jobs, 'default', 'desc').map((r) => r.jobNumber)).toEqual(['1001', 'HGR6P4', 'PS5CTO']);
    });

    it('sorts on every column, numbers as numbers, the job date too (Workiz\'s own Date header fails)', () => {
      const rows = jobsOfTech(jobs, 't1', lk, true);
      expect(sortJobs(rows, jobs, 'tip', 'desc').map((r) => r.tip)).toEqual([32.31, 5, 0]);
      expect(sortJobs(rows, jobs, 'total', 'asc').map((r) => r.total)).toEqual([50, 147.87, 641.63]);
      expect(sortJobs(rows, jobs, 'date', 'asc').map((r) => r.jobNumber)).toEqual(['HGR6P4', 'PS5CTO', '1001']);
      expect(sortJobs(rows, jobs, 'jobType', 'asc').map((r) => r.jobType)).toEqual(['Car Key Copy', 'Car Key Copy', 'Lockout']);
      expect(sortJobs(rows, jobs, 'job', 'asc').map((r) => r.jobNumber)).toEqual(['1001', 'HGR6P4', 'PS5CTO']);
    });
  });
});
