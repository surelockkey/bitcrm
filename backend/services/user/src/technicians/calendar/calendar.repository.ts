import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CalendarEvent } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  CAL_SK_PREFIX,
  calSk,
  MAX_EVENT_DAYS,
} from '../constants/dynamo.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Shift an ISO date "YYYY-MM-DD" by `days` (can be negative). */
function shiftDate(dateISO: string, days: number): string {
  return new Date(Date.parse(`${dateISO}T00:00:00Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class CalendarRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(technicianId: string, startDate: string, id: string) {
    return { PK: `USER#${technicianId}`, SK: calSk(startDate, id) };
  }

  async create(event: CalendarEvent): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          ...this.key(event.technicianId, event.startDate, event.id),
          ...event,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR attribute_not_exists(SK)',
      }),
    );
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

  async update(
    event: Pick<CalendarEvent, 'technicianId' | 'startDate' | 'id'>,
    attrs: Partial<CalendarEvent>,
  ): Promise<CalendarEvent> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const immutable = new Set(['id', 'technicianId', 'startDate', 'createdBy', 'createdAt']);
    for (const [k, v] of Object.entries(attrs)) {
      if (immutable.has(k)) continue;
      const n = `#${k}`;
      names[n] = k;
      if (v === undefined) {
        removeParts.push(n);
      } else {
        setParts.push(`${n} = :${k}`);
        values[`:${k}`] = v;
      }
    }

    const segments: string[] = [];
    if (setParts.length) segments.push(`SET ${setParts.join(', ')}`);
    if (removeParts.length) segments.push(`REMOVE ${removeParts.join(', ')}`);

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: TECHNICIANS_TABLE,
        Key: this.key(event.technicianId, event.startDate, event.id),
        UpdateExpression: segments.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: Object.keys(values).length ? values : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toEvent(result.Attributes!);
  }

  async delete(
    event: Pick<CalendarEvent, 'technicianId' | 'startDate' | 'id'>,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: TECHNICIANS_TABLE,
        Key: this.key(event.technicianId, event.startDate, event.id),
      }),
    );
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
