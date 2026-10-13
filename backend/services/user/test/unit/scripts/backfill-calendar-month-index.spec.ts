import { CalendarEventType, type CalendarEvent } from '@bitcrm/types';
import { reconcileCalendarMonthIndex } from '../../../src/scripts/backfill-calendar-month-index';
import { CalendarRepository } from '../../../src/technicians/calendar/calendar.repository';
import { FakeDynamo } from '../technicians/calendar/fake-dynamo';

/**
 * backfill:calendar-month-index — a derived projection, so it RECONCILES:
 * month rows written where an event lacks them (or holds a stale copy),
 * deleted where no event explains them. Dry run unless asked to apply; every
 * write guarded on the event row as scanned; the state row only on a
 * complete apply.
 */
describe('backfill:calendar-month-index', () => {
  const T = 'BitCRM_Users';
  let db: FakeDynamo;
  const run = (apply: boolean) =>
    reconcileCalendarMonthIndex(db.client.send as any, { table: T, apply, log: () => undefined });

  const event = (id: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id,
    technicianId: 't1',
    type: CalendarEventType.TIME_OFF,
    title: `E ${id}`,
    startDate: '2026-07-30',
    endDate: '2026-08-02',
    allDay: true,
    createdBy: 'mgr',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
  /** An event row as written before the index existed: no month rows. */
  const legacyRow = (e: CalendarEvent) => db.put({ PK: `USER#${e.technicianId}`, SK: `CAL#${e.startDate}#${e.id}`, ...e });

  beforeEach(() => {
    db = new FakeDynamo();
    db.pageSize = 3; // the scan must page
  });

  function seed() {
    legacyRow(event('a')); // needs two month rows
    legacyRow(event('b', { startDate: '2026-07-05', endDate: '2026-07-05' }));
    db.put({ PK: 'CALDAY#2026-07', SK: '2026-07-05#TECH#t1#b', ...event('b', { startDate: '2026-07-05', endDate: '2026-07-05' }) }); // already right
    db.put({ PK: 'CALDAY#2026-06', SK: '2026-06-01#TECH#t1#gone', ...event('gone', { startDate: '2026-06-01', endDate: '2026-06-01' }) }); // orphan
    db.put({ PK: 'CALDAY#2026-09', SK: '2026-07-05#TECH#t1#b', ...event('b', { startDate: '2026-07-05', endDate: '2026-07-05' }) }); // month it no longer touches
    db.put({ PK: 'USER#t1', SK: 'METADATA', id: 't1' }); // unrelated
  }

  it('a dry run counts and writes nothing, and never stamps', async () => {
    seed();
    const before = db.rows().length;
    const out = await run(false);
    expect(out).toEqual(expect.objectContaining({ events: 2, pointers: 3, same: 1, written: 2, deleted: 2, skipped: 0 }));
    expect(out.readyAt).toBeUndefined();
    expect(db.rows().length).toBe(before);
    expect(db.sent.some((s) => s.name !== 'ScanCommand')).toBe(false);
  });

  it('--apply leaves exactly the rows the repository would have written, then stamps', async () => {
    seed();
    const out = await run(true);
    expect(out).toEqual(expect.objectContaining({ written: 2, deleted: 2, skipped: 0 }));
    expect(db.rows('CALDAY#').map((r) => `${r.PK} / ${r.SK}`)).toEqual([
      'CALDAY#2026-07 / 2026-07-05#TECH#t1#b',
      'CALDAY#2026-07 / 2026-07-30#TECH#t1#a',
      'CALDAY#2026-08 / 2026-07-30#TECH#t1#a',
    ]);
    const state = db.rows('CALMONTHINDEX')[0];
    expect(state).toEqual(expect.objectContaining({ SK: 'STATE', count: 2 }));
    expect(typeof state.readyAt).toBe('string');

    // And the index now answers like the per-technician read.
    const repo = new CalendarRepository({ client: db.client } as never);
    db.pageSize = Number.POSITIVE_INFINITY;
    expect(await repo.listByTechsInRange(['t1'], '2026-07-01', '2026-08-31')).toEqual(
      await repo.listByTechInRange('t1', '2026-07-01', '2026-08-31'),
    );
  });

  it('rewrites a stale copy', async () => {
    const e = event('a', { startDate: '2026-07-05', endDate: '2026-07-05', title: 'New title' });
    legacyRow(e);
    db.put({ PK: 'CALDAY#2026-07', SK: '2026-07-05#TECH#t1#a', ...e, title: 'Old title' });
    await run(true);
    expect(db.rows('CALDAY#')[0].title).toBe('New title');
  });

  it('is idempotent: a second run changes nothing', async () => {
    seed();
    await run(true);
    const out = await run(true);
    expect(out).toEqual(expect.objectContaining({ written: 0, deleted: 0, skipped: 0, same: 3 }));
  });

  it('skips an event edited mid-run instead of overwriting what its own write did', async () => {
    legacyRow(event('a'));
    const send = db.client.send.getMockImplementation()!;
    db.client.send.mockImplementation(async (cmd: any) => {
      if (cmd.constructor.name === 'TransactWriteCommand') {
        // The editor got there first: the row is newer than the scan saw.
        db.put({ ...db.rows('USER#')[0], updatedAt: '2026-05-05T00:00:00.000Z' });
      }
      return send(cmd);
    });
    const out = await run(true);
    expect(out.skipped).toBe(1);
    expect(db.rows('CALDAY#')).toEqual([]);
  });

  it('refuses to delete (or stamp) when it finds month rows but no events at all', async () => {
    db.put({ PK: 'CALDAY#2026-06', SK: '2026-06-01#TECH#t1#x', ...event('x') });
    const out = await run(true);
    expect(out.refused).toBeDefined();
    expect(out.readyAt).toBeUndefined();
    expect(db.rows('CALDAY#')).toHaveLength(1);
    expect(db.rows('CALMONTHINDEX')).toHaveLength(0);
  });
});
