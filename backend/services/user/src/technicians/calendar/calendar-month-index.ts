import { type CalendarEvent } from '@bitcrm/types';
import { MAX_EVENT_DAYS, calSk } from '../constants/dynamo.constants';

/**
 * The calendar month index — a main-table adjacency list, no GSI:
 *
 *   PK = CALDAY#<YYYY-MM>
 *   SK = <startDate>#TECH#<technicianId>#<eventId>
 *
 * One row per month an event TOUCHES, each a full copy of the event (the
 * `CalendarEvent` fields, nothing else). The schedule grid reads the months of
 * its window — one Query each, in parallel — instead of one Query per
 * technician reaching `MAX_EVENT_DAYS` back.
 *
 * Why rows and not a GSI key on the event row: an item holds one value per
 * index key, so an event that spans July and August could be filed under only
 * one month. A sparse GSI key on extra pointer rows would work too, but then
 * the pointer rows ARE the index and the GSI adds nothing but a Terraform
 * change and eventual consistency. A copy also means the read needs no
 * second hop to the event row.
 *
 * The event's own row (`USER#<techId> / CAL#<startDate>#<id>`) stays the
 * source of truth. Every write keeps the month rows in step in ONE
 * TransactWrite with the event row, guarded on the `updatedAt` the writer read
 * (`lockCondition`), so concurrent edits cannot leave a month row behind. An
 * event is at most `MAX_EVENT_DAYS` + 1 = 61 days → at most 4 months, so a move
 * is ≤ 10 transaction items.
 *
 * Derived projection: `backfill:calendar-month-index` reconciles it (writes the
 * missing / stale month rows, deletes the ones no event explains) and stamps
 * `CALMONTHINDEX / STATE`. Until that row exists the readers keep the
 * per-technician queries (`CalendarRepository.monthIndexReady`).
 */
export const CAL_MONTH_PK_PREFIX = 'CALDAY#';
export const calMonthPk = (month: string) => `${CAL_MONTH_PK_PREFIX}${month}`;
export const calMonthSk = (startDate: string, technicianId: string, id: string) =>
  `${startDate}#TECH#${technicianId}#${id}`;

/** `CALMONTHINDEX / STATE { readyAt, count }` — stamped by the backfill's `--apply` only. */
export const CAL_MONTH_INDEX_STATE_KEY = { PK: 'CALMONTHINDEX', SK: 'STATE' } as const;

/** A window wider than this keeps the per-technician reads (a bounded fan-out either way). */
export const MAX_INDEXED_WINDOW_MONTHS = 24;

/** Exactly what a calendar row carries besides its keys — and what a month row copies. */
export const CALENDAR_EVENT_FIELDS = [
  'id', 'technicianId', 'type', 'title', 'startDate', 'endDate', 'allDay', 'timeSlot',
  'createdBy', 'createdAt', 'updatedAt',
] as const;

type Row = Record<string, unknown>;
type Key = { PK: string; SK: string };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shift an ISO date "YYYY-MM-DD" by `days` (can be negative). */
export function shiftDate(dateISO: string, days: number): string {
  return new Date(Date.parse(`${dateISO}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/** Every `YYYY-MM` the inclusive [startDate, endDate] touches; none for an unreadable date. */
export function monthsSpanned(startDate: string, endDate: string): string[] {
  const parse = (d: string) => {
    const m = /^(\d{4})-(\d{2})/.exec(d ?? '');
    return m ? { y: Number(m[1]), m: Number(m[2]) } : null;
  };
  const a = parse(startDate);
  const b = parse(endDate);
  if (!a || !b) return [];
  const months: string[] = [];
  let { y, m } = a;
  // An inverted span still files its start month.
  do {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  } while (y < b.y || (y === b.y && m <= b.m));
  return months;
}

/** The event's own fields, nothing undefined. */
function eventFields(event: Row): Row {
  const out: Row = {};
  for (const f of CALENDAR_EVENT_FIELDS) if (event[f] !== undefined) out[f] = event[f];
  return out;
}

/** The month rows an event should have. */
export function monthPointers(event: CalendarEvent): (Key & Row)[] {
  const sk = calMonthSk(event.startDate, event.technicianId, event.id);
  return monthsSpanned(event.startDate, event.endDate).map((month) => ({
    PK: calMonthPk(month),
    SK: sk,
    ...eventFields(event as unknown as Row),
  }));
}

export function monthPointerKeys(event: Pick<CalendarEvent, 'startDate' | 'endDate' | 'technicianId' | 'id'>): Key[] {
  const sk = calMonthSk(event.startDate, event.technicianId, event.id);
  return monthsSpanned(event.startDate, event.endDate).map((month) => ({ PK: calMonthPk(month), SK: sk }));
}

/** The event row's key. */
export function eventKey(event: Pick<CalendarEvent, 'technicianId' | 'startDate' | 'id'>): Key {
  return { PK: `USER#${event.technicianId}`, SK: calSk(event.startDate, event.id) };
}

/**
 * The condition that the event row still holds the `updatedAt` the writer
 * read — the optimistic lock every calendar write carries.
 */
export function lockCondition(updatedAt: string | undefined): {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  return updatedAt === undefined
    ? {
        ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(#updatedAt)',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
      }
    : {
        ConditionExpression: 'attribute_exists(PK) AND #updatedAt = :prevUpdatedAt',
        ExpressionAttributeNames: { '#updatedAt': 'updatedAt' },
        ExpressionAttributeValues: { ':prevUpdatedAt': updatedAt },
      };
}

/**
 * The per-technician answer, rebuilt from month rows: exactly what
 * `listByTechInRange` returns for each id in `technicianIds`, concatenated in
 * request order (a repeated id repeats its events, as the fan-out did).
 *
 * The legacy query's bounds are reproduced verbatim — `CAL#<startDate>#<id>`
 * BETWEEN `CAL#<from − MAX_EVENT_DAYS>` and `CAL#<to>~`, then `endDate >= from`
 * — so an over-long imported event that the old low bound cut off stays cut
 * off here too, and the grid agrees with one technician's own view.
 */
export function selectForWindow(
  events: CalendarEvent[],
  technicianIds: string[],
  from: string,
  to: string,
): CalendarEvent[] {
  const lo = shiftDate(from, -MAX_EVENT_DAYS);
  const hi = `${to}~`;
  const wanted = new Set(technicianIds);
  const byTech = new Map<string, Map<string, CalendarEvent>>();
  for (const e of events) {
    if (!wanted.has(e.technicianId)) continue;
    const sortKey = `${e.startDate}#${e.id}`;
    if (sortKey < lo || sortKey > hi || !(e.endDate >= from)) continue;
    const mine = byTech.get(e.technicianId) ?? new Map<string, CalendarEvent>();
    byTech.set(e.technicianId, mine);
    mine.set(e.id, e); // one copy per month — keep one
  }
  const ordered = new Map<string, CalendarEvent[]>();
  for (const [techId, mine] of byTech) {
    ordered.set(
      techId,
      [...mine.values()].sort((a, b) => {
        const ka = `${a.startDate}#${a.id}`;
        const kb = `${b.startDate}#${b.id}`;
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      }),
    );
  }
  return technicianIds.flatMap((id) => ordered.get(id) ?? []);
}

/* --------------------------------------------------------------- reconcile */

export interface MonthIndexPlan {
  events: number;
  pointers: number;
  /** Month rows already exactly right. */
  same: number;
  /** Per event: the month rows to (re)write, guarded on the event as scanned. */
  puts: { event: Row & Key; items: (Row & Key)[] }[];
  /** Month rows no event explains, each guarded on its event as scanned. */
  deletes: { pointer: Key; event: Key; eventUpdatedAt: string | undefined; eventExists: boolean }[];
}

const isEventRow = (r: Row) => String(r.PK).startsWith('USER#') && String(r.SK).startsWith('CAL#');
const isPointerRow = (r: Row) => String(r.PK).startsWith(CAL_MONTH_PK_PREFIX);
const k = (key: Key) => `${key.PK}\u0000${key.SK}`;

function sameCopy(expected: Row, actual: Row): boolean {
  for (const f of CALENDAR_EVENT_FIELDS) if (expected[f] !== actual[f]) return false;
  return true;
}

/** What the month index needs, from a scan of the event rows and the month rows. */
export function planCalendarMonthIndex(rows: Row[]): MonthIndexPlan {
  const events = rows.filter(isEventRow) as (Row & Key)[];
  const pointers = new Map<string, Row & Key>();
  for (const r of rows) if (isPointerRow(r)) pointers.set(k(r as Key), r as Row & Key);
  const eventsByKey = new Map(events.map((e) => [k(e), e]));

  const plan: MonthIndexPlan = { events: events.length, pointers: pointers.size, same: 0, puts: [], deletes: [] };
  const expectedKeys = new Set<string>();

  for (const e of events) {
    const items = monthPointers(e as unknown as CalendarEvent);
    const todo: (Row & Key)[] = [];
    for (const item of items) {
      expectedKeys.add(k(item));
      const have = pointers.get(k(item));
      if (have && sameCopy(item, have)) plan.same += 1;
      else todo.push(item);
    }
    if (todo.length) plan.puts.push({ event: e, items: todo });
  }

  for (const [key, p] of pointers) {
    if (expectedKeys.has(key)) continue;
    const ev = eventKey({
      technicianId: String(p.technicianId),
      startDate: String(p.startDate),
      id: String(p.id),
    });
    const owner = eventsByKey.get(k(ev));
    plan.deletes.push({
      pointer: { PK: p.PK, SK: p.SK },
      event: ev,
      eventExists: !!owner,
      eventUpdatedAt: owner?.updatedAt as string | undefined,
    });
  }
  return plan;
}
