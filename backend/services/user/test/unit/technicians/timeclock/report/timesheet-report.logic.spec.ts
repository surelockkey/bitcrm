import { type TimeClockEntry } from '@bitcrm/types';
import {
  entryCost,
  entryMinutes,
  matchesSearch,
  paginate,
  passesJobFilter,
  personName,
  personTotals,
  publicRow,
  sortLines,
  toEntryRow,
  toLine,
  totalOf,
} from '../../../../../src/technicians/timeclock/report/timesheet-report.logic';

let seq = 0;
function e(startedAt: string, endedAt?: string, over: Partial<TimeClockEntry> = {}): TimeClockEntry {
  const minutes = endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 60_000)) : undefined;
  seq += 1;
  return {
    id: `tc-${seq}`,
    userId: 'u1',
    startedAt,
    ...(endedAt ? { endedAt, minutes } : {}),
    source: 'mobile',
    createdAt: startedAt,
    updatedAt: endedAt ?? startedAt,
    ...over,
  };
}

describe('Timesheets report arithmetic', () => {
  describe('entryMinutes / entryCost', () => {
    it('is the stored minutes of a closed entry, and nothing while it runs', () => {
      expect(entryMinutes(e('2026-09-01T12:00:00.000Z', '2026-09-01T13:30:00.000Z'))).toBe(90);
      expect(entryMinutes(e('2026-09-01T12:00:00.000Z'))).toBe(0);
    });

    // Three Workiz rows end before they start; Workiz prints 0:00 for them.
    it('never goes negative', () => {
      expect(entryMinutes(e('2023-03-07T20:00:00.000Z', '2023-03-07T16:12:00.000Z'))).toBe(0);
    });

    it('costs minutes / 60 × the entry\'s own rate', () => {
      expect(entryCost(e('2026-09-01T12:00:00.000Z', '2026-09-01T13:30:00.000Z', { laborCostPerHour: 40 }))).toBe(60);
      expect(entryCost(e('2026-09-01T12:00:00.000Z', '2026-09-01T13:30:00.000Z'))).toBe(0);
    });
  });

  describe('personTotals — measured against Workiz', () => {
    // (2) TX - Matthew Salinas, 29.04.2025 (Workiz report_id 139107): one entry
    // entered twice and a long one overlapping a shorter one. Workiz: Hours
    // 2370 min (39:30), Gross Hours 3038 min (50:38), Jobs 1.
    it('counts overlapping entries once in Hours and twice in Gross Hours', () => {
      const t = personTotals([
        e('2025-04-29T14:32:00.000Z', '2025-04-29T20:29:00.000Z'),
        e('2025-04-29T20:29:00.000Z', '2025-04-29T21:16:00.000Z', { dealId: 'deal-4U6KR4' }),
        e('2025-04-29T20:29:00.000Z', '2025-04-29T21:16:00.000Z', { dealId: 'deal-4U6KR4' }),
        e('2025-04-29T21:16:00.000Z', '2025-05-01T06:02:00.000Z'),
        e('2025-04-29T21:16:00.000Z', '2025-04-30T07:37:00.000Z'),
      ]);
      expect(t.minutes).toBe(2370);
      expect(t.grossMinutes).toBe(3038);
      expect(t.jobs.size).toBe(1);
      expect(t.entries).toBe(5);
    });

    // (2) CT - Chris Ray at $40/h: 65 overlapping minutes over two days. Workiz,
    // all time: Cost $30,517.33 vs Gross Cost $30,560.67 — 65 min × $40 apart.
    it('pays a shared stretch once', () => {
      const r = { laborCostPerHour: 40 };
      const t = personTotals([
        e('2026-06-09T15:00:00.000Z', '2026-06-09T16:00:00.000Z', r),
        e('2026-06-09T15:25:00.000Z', '2026-06-09T15:48:00.000Z', r), // inside the one above
        e('2026-06-11T11:55:00.000Z', '2026-06-11T13:37:00.000Z', r),
        e('2026-06-11T12:55:00.000Z', '2026-06-11T13:55:00.000Z', r), // 42 min shared
      ]);
      expect(t.grossMinutes).toBe(245);
      expect(t.minutes).toBe(180);
      expect(t.grossCost).toBeCloseTo((245 / 60) * 40, 9);
      expect(t.grossCost - t.cost).toBeCloseTo((65 / 60) * 40, 9);
    });

    it('charges the shared stretch at the rate of the entry that started first', () => {
      const t = personTotals([
        e('2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z', { laborCostPerHour: 40 }),
        e('2026-09-01T10:30:00.000Z', '2026-09-01T11:30:00.000Z', { laborCostPerHour: 20 }),
      ]);
      expect(t.minutes).toBe(90);
      expect(t.grossCost).toBeCloseTo(60, 9);
      expect(t.cost).toBeCloseTo(50, 9);
    });

    // Sales Platinum, September 2026: one entry, still running since 04.09 —
    // Workiz: Hours 00:00, Jobs 0, a line all the same.
    it('lists a running entry but counts no time for it', () => {
      const t = personTotals([e('2026-09-04T17:23:00.000Z', undefined, { dealId: 'd1' })]);
      expect(t).toMatchObject({ minutes: 0, grossMinutes: 0, cost: 0, entries: 1 });
      expect(t.jobs.size).toBe(1);
    });

    it('equals gross when nothing overlaps', () => {
      const t = personTotals([
        e('2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z'),
        e('2026-09-01T11:00:00.000Z', '2026-09-01T12:15:00.000Z'),
      ]);
      expect(t.minutes).toBe(t.grossMinutes);
      expect(t.minutes).toBe(135);
    });
  });

  describe('lines and the total row', () => {
    const line = (id: string, name: string, entries: TimeClockEntry[], money = true) =>
      toLine(id, name, false, personTotals(entries.map((x) => ({ ...x, userId: id }))), money);

    it('rounds money to cents and leaves it out without financials', () => {
      const entries = [e('2026-09-01T10:00:00.000Z', '2026-09-01T10:10:00.000Z', { laborCostPerHour: 40 })];
      expect(line('u1', 'A', entries).cost).toBe(6.67);
      const hidden = line('u1', 'A', entries, false);
      expect('cost' in hidden).toBe(false);
      expect('grossCost' in hidden).toBe(false);
    });

    // Workiz, all time: Gross Cost $34,978.58, while its rows rounded one by one add up to .59.
    it('rounds the total from the exact sums, not from rounded rows', () => {
      const tenMin = (id: string) =>
        line(id, id, [e('2026-09-01T10:00:00.000Z', '2026-09-01T10:10:00.000Z', { laborCostPerHour: 40 })]);
      const a = tenMin('u1'); // $6.6666… → 6.67
      const b = tenMin('u2');
      const c = tenMin('u3');
      expect((a.cost ?? 0) + (b.cost ?? 0) + (c.cost ?? 0)).toBeCloseTo(20.01, 9);
      expect(totalOf([a, b, c], true).cost).toBe(20);
    });

    it('sends neither the job set nor the exact money', () => {
      const row = publicRow(line('u1', 'A', [e('2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z', { dealId: 'd1' })]));
      expect(Object.keys(row).sort()).toEqual(
        ['clockedIn', 'cost', 'entries', 'grossCost', 'grossMinutes', 'jobs', 'minutes', 'name', 'userId'].sort(),
      );
    });

    // Workiz 2025: the rows' Jobs add up to 1 302, the total row says 1 299 —
    // three jobs had two people on them.
    it('counts a job two people worked once in the total', () => {
      const a = line('u1', 'A', [e('2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z', { dealId: 'd1' })]);
      const b = line('u2', 'B', [
        e('2026-09-01T10:00:00.000Z', '2026-09-01T11:00:00.000Z', { dealId: 'd1' }),
        e('2026-09-02T10:00:00.000Z', '2026-09-02T11:00:00.000Z', { dealId: 'd2' }),
      ]);
      expect(a.jobs + b.jobs).toBe(3);
      expect(totalOf([a, b], true)).toMatchObject({ minutes: 180, grossMinutes: 180, jobs: 2, entries: 3 });
    });
  });

  describe('filters, search, sort, pages', () => {
    it('applies the Jobs group: with, without, both', () => {
      const withJob = e('2026-09-01T10:00:00.000Z', undefined, { dealId: 'd' });
      const without = e('2026-09-01T10:00:00.000Z');
      expect(passesJobFilter(withJob, ['with_job'])).toBe(true);
      expect(passesJobFilter(without, ['with_job'])).toBe(false);
      expect(passesJobFilter(without, ['without_job'])).toBe(true);
      expect(passesJobFilter(withJob, ['without_job'])).toBe(false);
      expect(passesJobFilter(without, ['with_job', 'without_job'])).toBe(true);
      expect(passesJobFilter(without, undefined)).toBe(true);
    });

    it('finds a person by any part of the name, any case', () => {
      expect(matchesSearch('Chris Ray', 'ray')).toBe(true);
      expect(matchesSearch('Yeter Mizrahi', 'MIZ')).toBe(true);
      expect(matchesSearch('Yeter Mizrahi', 'ONW3G7')).toBe(false);
      expect(matchesSearch('anyone', '  ')).toBe(true);
    });

    it('names a person by first and last name, then e-mail, then id', () => {
      expect(personName({ firstName: 'Yeter', lastName: 'Mizrahi' }, 'u1')).toBe('Yeter Mizrahi');
      expect(personName({ firstName: '', lastName: '', email: 'x@y.z' }, 'u1')).toBe('x@y.z');
      expect(personName(undefined, 'u1')).toBe('u1');
    });

    const rows = [
      { userId: 'a', name: 'Sales Platinum', clockedIn: true, minutes: 0, grossMinutes: 0, cost: 0, jobs: 0, entries: 1 },
      { userId: 'b', name: 'Bohdan TECH', clockedIn: true, minutes: 0, grossMinutes: 0, cost: 0, jobs: 1, entries: 1 },
      { userId: 'c', name: 'Chris Ray', clockedIn: false, minutes: 9535, grossMinutes: 9535, cost: 6356.67, jobs: 0, entries: 18 },
      { userId: 'd', name: 'Yeter Mizrahi', clockedIn: true, minutes: 8757, grossMinutes: 8757, cost: 0, jobs: 34, entries: 50 },
    ];

    it('sorts by name, descending by default in Workiz', () => {
      expect(sortLines(rows, 'name', 'desc').map((r) => r.name)).toEqual([
        'Yeter Mizrahi',
        'Sales Platinum',
        'Chris Ray',
        'Bohdan TECH',
      ]);
    });

    it('sorts by a number and keeps ties in name order', () => {
      expect(sortLines(rows, 'hours', 'desc').map((r) => r.userId)).toEqual(['c', 'd', 'b', 'a']);
      expect(sortLines(rows, 'hours', 'asc').map((r) => r.userId)).toEqual(['b', 'a', 'd', 'c']);
      expect(sortLines(rows, 'jobs', 'desc').map((r) => r.userId)).toEqual(['d', 'b', 'c', 'a']);
      expect(sortLines(rows, 'cost', 'desc')[0].userId).toBe('c');
    });

    it('pages like the Jobs report: "Showing 3 to 4 of 4"', () => {
      const p = paginate(rows, 2, 2);
      expect(p.pagination).toEqual({ page: 2, pageSize: 2, total: 4, pages: 2, from: 3, to: 4 });
      expect(paginate([], 1, 10).pagination).toEqual({ page: 1, pageSize: 10, total: 0, pages: 1, from: 0, to: 0 });
      expect(paginate(rows, 9, 2).pagination.page).toBe(2);
    });
  });

  describe('toEntryRow', () => {
    it('marks a running entry and hides money without financials', () => {
      const row = toEntryRow(e('2026-09-04T17:23:00.000Z', undefined, { laborCostPerHour: 40 }), false);
      expect(row).toMatchObject({ open: true, minutes: 0 });
      expect('cost' in row).toBe(false);
      expect('laborCostPerHour' in row).toBe(false);
    });

    it('carries the job, both fixes and the note', () => {
      const row = toEntryRow(
        e('2026-09-29T16:34:00.000Z', '2026-09-29T22:46:00.000Z', {
          dealId: 'd1',
          startLocation: { lat: 41.38, lng: -72.82 },
          endLocation: { lat: 41.26, lng: -72.94 },
          notes: 'Forgot to clock out',
          laborCostPerHour: 25,
        }),
        true,
      );
      expect(row).toMatchObject({ open: false, minutes: 372, cost: 155, laborCostPerHour: 25, dealId: 'd1' });
      expect(row.endLocation).toEqual({ lat: 41.26, lng: -72.94 });
      expect(row.notes).toBe('Forgot to clock out');
    });
  });
});
