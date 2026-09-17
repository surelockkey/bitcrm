import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  MESSAGING_TABLE,
  METADATA_SK,
  MESSAGING_TTL_ATTRIBUTE,
} from '../../common/constants/dynamo.constants';
import { compact, epochSeconds, stripKeys } from '../../common/items';
import { DEAL_SNAPSHOT_TTL_SECONDS, dealSnapshotPk } from '../automations.constants';
import { type AutomationDealFacts } from './facts';

/** The last schedule messaging saw for a job. */
export interface DealScheduleSnapshot {
  dealId: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  seenAt: string;
}

/**
 * `DEALSNAP#<dealId>` / `METADATA` — "the job was scheduled like this the
 * last time we heard about it".
 *
 * deal-service publishes `deal.updated` for every field edit without
 * saying which field moved, and does not publish `deal.scheduled_changed`
 * at all (verified against `DealsService.publishEvent`, 2026-09-16). A
 * reschedule rule therefore cannot be driven by the event alone: the
 * consumer re-reads the job — which it does anyway to evaluate conditions —
 * and compares it with this row. A changed date, end date or slot is a
 * reschedule and raises the synthetic `deal.scheduled_changed`; everything
 * else is an ordinary edit. The day deal-service publishes the real event,
 * it is consumed directly and this row just keeps agreeing with it.
 */
@Injectable()
export class DealSnapshotRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(dealId: string): Promise<DealScheduleSnapshot | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: dealSnapshotPk(dealId), SK: METADATA_SK } }),
    );
    return res.Item ? stripKeys<DealScheduleSnapshot>(res.Item, [MESSAGING_TTL_ATTRIBUTE]) : null;
  }

  async put(snapshot: DealScheduleSnapshot): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: dealSnapshotPk(snapshot.dealId),
          SK: METADATA_SK,
          ...compact(snapshot as unknown as Record<string, unknown>),
          [MESSAGING_TTL_ATTRIBUTE]: epochSeconds(snapshot.seenAt) + DEAL_SNAPSHOT_TTL_SECONDS,
        },
      }),
    );
  }
}

export const snapshotOf = (deal: AutomationDealFacts, at: string): DealScheduleSnapshot => ({
  dealId: deal.id,
  scheduledDate: deal.scheduledDate,
  scheduledEndDate: deal.scheduledEndDate,
  scheduledTimeSlot: deal.scheduledTimeSlot,
  seenAt: at,
});

/** Did the job's schedule move since the snapshot? A first sighting never counts as a move. */
export const isReschedule = (
  previous: DealScheduleSnapshot | null,
  next: DealScheduleSnapshot,
): boolean =>
  !!previous &&
  (previous.scheduledDate !== next.scheduledDate ||
    previous.scheduledEndDate !== next.scheduledEndDate ||
    previous.scheduledTimeSlot !== next.scheduledTimeSlot);
