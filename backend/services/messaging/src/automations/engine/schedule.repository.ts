import { Injectable } from '@nestjs/common';
import { DeleteCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { MESSAGING_TABLE, MESSAGING_TTL_ATTRIBUTE } from '../../common/constants/dynamo.constants';
import { compact, epochSeconds, stripKeys } from '../../common/items';
import { isConditionalCheckFailed } from '../../common/dynamo-errors';
import { SCHEDULE_TTL_SECONDS, dueMinuteOf, schedulePk, scheduleSk } from '../automations.constants';

/** One firing waiting for its minute. */
export interface ScheduledFiring {
  ruleId: string;
  /** `deal:<id>` — the entity the run log files it under. */
  entity: string;
  occurrence: string;
  /** ISO instant the actions should run at. */
  dueAt: string;
  dealId?: string;
  /** Why it is waiting: the rule's own delay, or a window that was shut. */
  reason: 'delay' | 'quiet_hours' | 'working_hours' | 'relative';
  /** The event that armed it, JSON — replayed verbatim when the minute comes. */
  event: string;
  /** `schedule.relative` only: the job date the timer was computed from; a reschedule invalidates it. */
  anchorAt?: string;
  createdAt: string;
}

/**
 * `SCHEDULE#<YYYY-MM-DDTHH:MM>` / `<ruleId>#<entity>#<occurrence>` — the
 * timer store behind delayed actions ("send 1 day after the status
 * changed"), held quiet-hours sends and the relative reminders ("1 hour
 * before the job").
 *
 * Why a minute bucket and a poller rather than SQS delay hops: a delay of
 * 1 day is well past SQS's 15-minute maximum, so a queue would need a chain
 * of re-enqueues, and nothing could then list, show or cancel what is
 * pending. One partition per minute is a single key-condition Query with no
 * index and no Scan, the poller is a plain interval the service already
 * has a pattern for, and everything waiting is visible in the table. Items
 * are written with `attribute_not_exists`, so arming twice is one timer.
 */
@Injectable()
export class AutomationScheduleRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `false` when the same firing is already armed for that minute. */
  async arm(firing: ScheduledFiring): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: schedulePk(dueMinuteOf(firing.dueAt)),
            SK: scheduleSk(firing.ruleId, firing.entity, firing.occurrence),
            ...compact(firing as unknown as Record<string, unknown>),
            [MESSAGING_TTL_ATTRIBUTE]: epochSeconds(firing.dueAt) + SCHEDULE_TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }
  }

  /** Everything due in one UTC minute (`2026-09-16T13:45`). */
  async dueIn(minute: string): Promise<ScheduledFiring[]> {
    const items: ScheduledFiring[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': schedulePk(minute) },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...(res.Items ?? []).map((i) => stripKeys<ScheduledFiring>(i, [MESSAGING_TTL_ATTRIBUTE])));
      exclusiveStartKey = res.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  async remove(firing: Pick<ScheduledFiring, 'ruleId' | 'entity' | 'occurrence' | 'dueAt'>): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: schedulePk(dueMinuteOf(firing.dueAt)),
          SK: scheduleSk(firing.ruleId, firing.entity, firing.occurrence),
        },
      }),
    );
  }
}
