import { ConflictException } from '@nestjs/common';
import { CalendarEventType, type CalendarEvent } from '@bitcrm/types';
import { CalendarRepository } from '../../../../src/technicians/calendar/calendar.repository';
import {
  CAL_MONTH_INDEX_STATE_KEY,
  monthsSpanned,
  monthPointers,
} from '../../../../src/technicians/calendar/calendar-month-index';
import { FakeDynamo } from './fake-dynamo';

/**
 * The calendar month index: every event is also filed under
 * `CALDAY#<YYYY-MM> / <startDate>#TECH#<techId>#<eventId>` for EVERY month it
 * touches, so the schedule grid reads the window's months (one Query each)
 * instead of one Query per technician reaching 60 days back.
 */
let seq = 0;
function ev(over: Partial<CalendarEvent> & Pick<CalendarEvent, 'technicianId' | 'startDate' | 'endDate'>): CalendarEvent {
  seq += 1;
  const allDay = over.allDay ?? over.startDate !== over.endDate;
  return {
    id: over.id ?? `evt-${String(seq).padStart(3, '0')}`,
    type: CalendarEventType.TIME_OFF,
    title: `Event ${seq}`,
    allDay,
    ...(allDay ? {} : { timeSlot: '12:00-13:00' }),
    createdBy: 'mgr-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as CalendarEvent;
}

describe('monthsSpanned', () => {
  it('is one month for an event inside a month', () => {
    expect(monthsSpanned('2026-07-24', '2026-07-26')).toEqual(['2026-07']);
  });
  it('lists every month an event touches, across a year boundary', () => {
    expect(monthsSpanned('2026-12-30', '2027-01-02')).toEqual(['2026-12', '2027-01']);
  });
  it('reaches four months for the longest event the validator allows (61 days)', () => {
    expect(monthsSpanned('2026-01-31', '2026-04-01')).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
  });
  it('is nothing for a date it cannot read', () => {
    expect(monthsSpanned('garbage', '2026-01-01')).toEqual([]);
  });
});

describe('monthPointers', () => {
  it('copies the event under each month, keyed by start date, tech and id', () => {
    const e = ev({ id: 'e1', technicianId: 't1', startDate: '2026-07-30', endDate: '2026-08-02' });
    const rows = monthPointers(e);
    expect(rows.map((r) => [r.PK, r.SK])).toEqual([
      ['CALDAY#2026-07', '2026-07-30#TECH#t1#e1'],
      ['CALDAY#2026-08', '2026-07-30#TECH#t1#e1'],
    ]);
    expect(rows[0]).toEqual(expect.objectContaining({ id: 'e1', technicianId: 't1', title: e.title }));
  });
});

describe('CalendarRepository — month index', () => {
  let db: FakeDynamo;
  let repo: CalendarRepository;

  beforeEach(() => {
    db = new FakeDynamo();
    repo = new CalendarRepository({ client: db.client } as never);
  });

  const fixture = (): CalendarEvent[] => [
    ev({ technicianId: 't1', startDate: '2026-07-24', endDate: '2026-07-24', allDay: false }),
    ev({ technicianId: 't1', startDate: '2026-07-20', endDate: '2026-07-22' }), // multi-day
    ev({ technicianId: 't1', startDate: '2026-06-25', endDate: '2026-07-03' }), // crosses a month
    ev({ technicianId: 't2', startDate: '2026-05-20', endDate: '2026-07-19' }), // three months, 60 days
    ev({ technicianId: 't2', startDate: '2026-07-31', endDate: '2026-08-02' }),
    ev({ technicianId: 't2', startDate: '2026-07-31', endDate: '2026-07-31', allDay: false }),
    ev({ technicianId: 't3', startDate: '2026-12-28', endDate: '2027-01-04' }), // year boundary
    ev({ technicianId: 't3', startDate: '2026-07-01', endDate: '2026-07-01', allDay: false }),
    ev({ technicianId: 't4', startDate: '2026-07-10', endDate: '2026-07-10', allDay: false }), // not asked for
    ev({ technicianId: 't1', startDate: '2026-09-01', endDate: '2026-09-30' }),
  ];

  async function seed(events: CalendarEvent[]) {
    for (const e of events) await repo.create(e);
  }

  /** Today's algorithm: one per-technician query each, concatenated in request order. */
  async function legacy(techIds: string[], from: string, to: string) {
    return (await Promise.all(techIds.map((id) => repo.listByTechInRange(id, from, to)))).flat();
  }

  it('create files the event row and one month row per month it touches', async () => {
    const e = ev({ id: 'x', technicianId: 't1', startDate: '2026-06-25', endDate: '2026-07-03' });
    await repo.create(e);
    expect(db.rows().map((r) => `${r.PK} / ${r.SK}`)).toEqual([
      'CALDAY#2026-06 / 2026-06-25#TECH#t1#x',
      'CALDAY#2026-07 / 2026-06-25#TECH#t1#x',
      'USER#t1 / CAL#2026-06-25#x',
    ]);
    // One atomic write: no event without its month rows.
    expect(db.sent.filter((s) => s.name === 'TransactWriteCommand')).toHaveLength(1);
  });

  it.each([
    ['2026-07-20', '2026-07-26'], // a week
    ['2026-07-24', '2026-07-24'], // a day
    ['2026-07-27', '2026-08-02'], // a week across months
    ['2026-06-01', '2026-09-30'], // several months
    ['2026-12-29', '2027-01-02'], // across a year
    ['2026-07-04', '2026-07-04'], // only the long event covers it
    ['2026-10-01', '2026-10-31'], // nothing
  ])('answers %s..%s exactly as the per-technician reads do', async (from, to) => {
    await seed(fixture());
    const techIds = ['t2', 't1', 't3'];
    const expected = await legacy(techIds, from, to);
    const actual = await repo.listByTechsInRange(techIds, from, to);
    expect(actual).toEqual(expected);
  });

  it('keeps request order, repeated ids included, and reads one Query per month', async () => {
    await seed(fixture());
    db.sent.length = 0;
    const actual = await repo.listByTechsInRange(['t3', 't1', 't3'], '2026-07-20', '2026-08-05');
    expect(actual).toEqual(await legacy(['t3', 't1', 't3'], '2026-07-20', '2026-08-05'));
    // The legacy reads above added three; ours were the first two.
    const ours = db.sent.slice(0, 2);
    expect(ours.map((s) => s.input.ExpressionAttributeValues[':pk']).sort()).toEqual(['CALDAY#2026-07', 'CALDAY#2026-08']);
  });

  it('follows LastEvaluatedKey to the end of a month', async () => {
    await seed(fixture());
    const expected = await legacy(['t1', 't2', 't3'], '2026-07-01', '2026-07-31');
    db.pageSize = 1;
    expect(await repo.listByTechsInRange(['t1', 't2', 't3'], '2026-07-01', '2026-07-31')).toEqual(expected);
  });

  it('asks for nothing when no technicians are named', async () => {
    db.sent.length = 0;
    expect(await repo.listByTechsInRange([], '2026-07-01', '2026-07-31')).toEqual([]);
    expect(db.sent).toHaveLength(0);
  });

  describe('maintenance', () => {
    const base = () => ev({ id: 'm', technicianId: 't1', startDate: '2026-07-20', endDate: '2026-07-22' });
    const monthRows = () => db.rows('CALDAY#').map((r) => `${r.PK} / ${r.SK}`);

    it('an update that stretches the end into the next month adds that month', async () => {
      const e = base();
      await repo.create(e);
      const out = await repo.update(e, { endDate: '2026-08-03', updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(out.endDate).toBe('2026-08-03');
      expect(monthRows()).toEqual(['CALDAY#2026-07 / 2026-07-20#TECH#t1#m', 'CALDAY#2026-08 / 2026-07-20#TECH#t1#m']);
      expect(db.rows('CALDAY#').every((r) => r.endDate === '2026-08-03')).toBe(true);
    });

    it('an update that shrinks it back drops the month it no longer touches', async () => {
      const e = ev({ id: 'm', technicianId: 't1', startDate: '2026-07-20', endDate: '2026-08-03' });
      await repo.create(e);
      await repo.update(e, { endDate: '2026-07-21', title: 'Shorter', updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(monthRows()).toEqual(['CALDAY#2026-07 / 2026-07-20#TECH#t1#m']);
      expect(db.rows('CALDAY#')[0].title).toBe('Shorter');
    });

    it('an update returns what the row now holds, a cleared slot included', async () => {
      const e = ev({ id: 'm', technicianId: 't1', startDate: '2026-07-20', endDate: '2026-07-20', allDay: false });
      await repo.create(e);
      const out = await repo.update(e, { allDay: true, timeSlot: undefined, updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(out).toEqual({ ...e, allDay: true, timeSlot: undefined, updatedAt: '2026-02-01T00:00:00.000Z' });
      expect(await repo.findById('t1', 'm')).toEqual(out);
    });

    it('a move rewrites the event row and every month row', async () => {
      const e = base();
      await repo.create(e);
      const next = { ...e, startDate: '2026-08-30', endDate: '2026-09-02', updatedAt: '2026-02-01T00:00:00.000Z' };
      await repo.move(e, next);
      expect(db.rows().map((r) => `${r.PK} / ${r.SK}`)).toEqual([
        'CALDAY#2026-08 / 2026-08-30#TECH#t1#m',
        'CALDAY#2026-09 / 2026-08-30#TECH#t1#m',
        'USER#t1 / CAL#2026-08-30#m',
      ]);
    });

    it('a delete takes the month rows with it', async () => {
      const e = ev({ id: 'm', technicianId: 't1', startDate: '2026-07-30', endDate: '2026-08-02' });
      await repo.create(e);
      await repo.delete(e);
      expect(db.rows()).toEqual([]);
    });

    it('refuses a write based on a stale read, so month rows never drift from the event', async () => {
      const e = base();
      await repo.create(e);
      await repo.update(e, { endDate: '2026-08-03', updatedAt: '2026-02-01T00:00:00.000Z' });
      // `e` is now stale: its updatedAt is the old one.
      await expect(repo.update(e, { title: 'x', updatedAt: '2026-02-02T00:00:00.000Z' })).rejects.toBeInstanceOf(
        ConflictException,
      );
      await expect(repo.delete(e)).rejects.toBeInstanceOf(ConflictException);
      await expect(repo.move(e, { ...e, startDate: '2026-07-25' })).rejects.toBeInstanceOf(ConflictException);
      expect(db.rows('CALDAY#')).toHaveLength(2);
    });
  });

  describe('monthIndexReady', () => {
    it('is false until the backfill stamps the state row, rechecked at most once a minute', async () => {
      expect(await repo.monthIndexReady(1_000)).toBe(false);
      db.put({ ...CAL_MONTH_INDEX_STATE_KEY, readyAt: '2026-10-13T00:00:00.000Z', count: 3 });
      expect(await repo.monthIndexReady(30_000)).toBe(false);
      expect(await repo.monthIndexReady(62_000)).toBe(true);
    });

    it('stays ready once seen, without asking again', async () => {
      db.put({ ...CAL_MONTH_INDEX_STATE_KEY, readyAt: '2026-10-13T00:00:00.000Z', count: 3 });
      expect(await repo.monthIndexReady(1)).toBe(true);
      db.sent.length = 0;
      expect(await repo.monthIndexReady(10_000_000)).toBe(true);
      expect(db.sent).toHaveLength(0);
    });

    it('counts an unreadable state row as not ready', async () => {
      db.client.send.mockRejectedValueOnce(new Error('throttled'));
      expect(await repo.monthIndexReady(1)).toBe(false);
    });
  });
});
