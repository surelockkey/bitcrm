import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CalendarEvent } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  CAL_SK_PREFIX,
  MAX_EVENT_DAYS,
} from '../constants/dynamo.constants';
import {
  CAL_MONTH_INDEX_STATE_KEY,
  eventKey,
  lockCondition,
  monthPointerKeys,
  monthPointers,
  monthsSpanned,
  calMonthPk,
  selectForWindow,
  shiftDate,
} from './calendar-month-index';

/** How long a "not ready" answer about the month index is trusted. */
const MONTH_INDEX_READY_RECHECK_MS = 60_000;

type TransactItem = NonNullable<
  ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']
>[number];

/**
 * Calendar events, two shapes in the users table:
 *
 *   USER#<techId> / CAL#<startDate>#<id>                      the event (source of truth)
 *   CALDAY#<YYYY-MM> / <startDate>#TECH#<techId>#<id>          a copy per month it touches
 *
 * No GSI keys on either. Every write moves both in one TransactWrite guarded on
 * the `updatedAt` it read — see `calendar-month-index.ts`.
 */
@Injectable()
export class CalendarRepository {
  private readonly logger = new Logger(CalendarRepository.name);
  private monthIndexState?: { ready: boolean; at: number };

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(event: CalendarEvent): Promise<void> {
    await this.transact([
      {
        Put: {
          TableName: TECHNICIANS_TABLE,
          Item: { ...eventKey(event), ...event },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...this.putPointers(event),
    ]);
  }

  /**
   * Events for one technician overlapping [from, to] (inclusive dates). The low
   * bound is widened by MAX_EVENT_DAYS because an all-day event can start before
   * `from` yet still overlap; the tail is filtered out in code.
   */
  async listByTechInRange(
    technicianId: string,
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    const lo = `${CAL_SK_PREFIX}${shiftDate(from, -MAX_EVENT_DAYS)}`;
    const hi = `${CAL_SK_PREFIX}${to}~`; // '~' sorts after any '<date>#<uuid>' for that day
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :lo AND :hi',
        ExpressionAttributeValues: { ':pk': `USER#${technicianId}`, ':lo': lo, ':hi': hi },
      }),
    );
    return (result.Items || [])
      .map((i) => this.toEvent(i))
      .filter((e) => e.endDate >= from);
  }

  /**
   * Events for many technicians overlapping [from, to], off the month index:
   * one Query per month of the window (in parallel, each paged to its end),
   * `SK <= <to>~` so nothing starting after the window is read, then
   * `selectForWindow` — the same answer, in the same order, as calling
   * `listByTechInRange` for each id. Read only once `monthIndexReady()`.
   */
  async listByTechsInRange(
    technicianIds: string[],
    from: string,
    to: string,
  ): Promise<CalendarEvent[]> {
    if (technicianIds.length === 0) return [];
    const months = monthsSpanned(from, to);
    const perMonth = await Promise.all(months.map((m) => this.readMonth(m, to)));
    return selectForWindow(perMonth.flat(), technicianIds, from, to);
  }

  private async readMonth(month: string, to: string): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          KeyConditionExpression: 'PK = :pk AND SK <= :hi',
          ExpressionAttributeValues: { ':pk': calMonthPk(month), ':hi': `${to}~` },
          ExclusiveStartKey: lastKey,
        }),
      );
      events.push(...(result.Items || []).map((i) => this.toEvent(i)));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return events;
  }

  /**
   * Whether the month index may be read: `CALMONTHINDEX / STATE` (stamped by
   * `backfill:calendar-month-index -- --apply`) exists. Asked again at most
   * once a minute while it does not; once it does, kept for the life of the
   * process. A failed read counts as not ready.
   */
  async monthIndexReady(now: number = Date.now()): Promise<boolean> {
    const known = this.monthIndexState;
    if (known?.ready) return true;
    if (known && now - known.at < MONTH_INDEX_READY_RECHECK_MS) return false;
    let ready = false;
    try {
      const res = await this.dynamoDb.client.send(
        new GetCommand({ TableName: TECHNICIANS_TABLE, Key: { ...CAL_MONTH_INDEX_STATE_KEY } }),
      );
      ready = typeof res.Item?.readyAt === 'string';
    } catch (error) {
      this.logger.warn(`calendar month index readiness unreadable — treated as not ready: ${(error as Error).message}`);
    }
    this.monthIndexState = { ready, at: now };
    return ready;
  }

  /** Locate one event by id without knowing its date (scans this tech's CAL# items). */
  async findById(technicianId: string, id: string): Promise<CalendarEvent | null> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        FilterExpression: '#id = :id',
        ExpressionAttributeNames: { '#id': 'id' },
        ExpressionAttributeValues: {
          ':pk': `USER#${technicianId}`,
          ':sk': CAL_SK_PREFIX,
          ':id': id,
        },
      }),
    );
    const item = (result.Items || [])[0];
    return item ? this.toEvent(item) : null;
  }

  /**
   * Edit an event in place (its start date unchanged). The row is replaced
   * whole — it holds only the event's fields — and the month rows follow:
   * rewritten for every month the edited event touches, deleted for the months
   * it no longer does. Returns what the row now holds.
   */
  async update(current: CalendarEvent, attrs: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const immutable = new Set(['id', 'technicianId', 'startDate', 'createdBy', 'createdAt']);
    const merged: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(attrs)) {
      if (immutable.has(k)) continue;
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const next = this.toEvent(merged);
    const keep = new Set(monthPointerKeys(next).map((key) => key.PK));
    await this.transact([
      {
        Put: {
          TableName: TECHNICIANS_TABLE,
          Item: { ...eventKey(current), ...next },
          ...lockCondition(current.updatedAt),
        },
      },
      ...this.putPointers(next),
      ...monthPointerKeys(current)
        .filter((key) => !keep.has(key.PK))
        .map((Key): TransactItem => ({ Delete: { TableName: TECHNICIANS_TABLE, Key } })),
    ]);
    return next;
  }

  /**
   * A start-date change: the event's key embeds the date, so the row moves —
   * old row and all its month rows out, new row and its month rows in, one
   * transaction.
   */
  async move(current: CalendarEvent, next: CalendarEvent): Promise<void> {
    await this.transact([
      { Delete: { TableName: TECHNICIANS_TABLE, Key: eventKey(current), ...lockCondition(current.updatedAt) } },
      ...this.deletePointers(current),
      {
        Put: {
          TableName: TECHNICIANS_TABLE,
          Item: { ...eventKey(next), ...next },
          ConditionExpression: 'attribute_not_exists(PK)',
        },
      },
      ...this.putPointers(next),
    ]);
  }

  async delete(event: CalendarEvent): Promise<void> {
    await this.transact([
      { Delete: { TableName: TECHNICIANS_TABLE, Key: eventKey(event), ...lockCondition(event.updatedAt) } },
      ...this.deletePointers(event),
    ]);
  }

  private putPointers(event: CalendarEvent): TransactItem[] {
    return monthPointers(event).map((Item) => ({ Put: { TableName: TECHNICIANS_TABLE, Item } }));
  }

  private deletePointers(event: CalendarEvent): TransactItem[] {
    return monthPointerKeys(event).map((Key) => ({ Delete: { TableName: TECHNICIANS_TABLE, Key } }));
  }

  /**
   * One TransactWrite. A failed condition means the event changed (or went)
   * since it was read — a 409, so the editor reloads rather than overwriting.
   */
  private async transact(items: TransactItem[]): Promise<void> {
    try {
      await this.dynamoDb.client.send(new TransactWriteCommand({ TransactItems: items }));
    } catch (err) {
      const e = err as { name?: string; CancellationReasons?: { Code?: string }[] };
      if (
        e.name === 'TransactionCanceledException' &&
        (e.CancellationReasons ?? []).some((r) => r?.Code === 'ConditionalCheckFailed')
      ) {
        throw new ConflictException('The calendar event changed meanwhile — reload and try again');
      }
      throw err;
    }
  }

  private toEvent(item: Record<string, unknown>): CalendarEvent {
    return {
      id: item.id as string,
      technicianId: item.technicianId as string,
      type: item.type as CalendarEvent['type'],
      title: item.title as string,
      startDate: item.startDate as string,
      endDate: item.endDate as string,
      allDay: item.allDay as boolean,
      timeSlot: item.timeSlot as string | undefined,
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
