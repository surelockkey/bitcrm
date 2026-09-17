import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { MESSAGING_TABLE } from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';
import { autoSentPk, autoSentSk } from './automations.constants';

/** "Rule `ruleId` already texted `techId` about `dealId`", with the schedule it was told. */
export interface AutoSentMarker {
  dealId: string;
  ruleId: string;
  techId: string;
  /** The job's `scheduledDate` at send time (`''` when unscheduled); a different one means a reschedule. */
  scheduledDate: string;
  /**
   * Which occurrence of the rule this marker is for, when the job's date is
   * not what decides. `send-to-tech:*` puts the click's `sentAt` here: a
   * redelivery of the same `deal.sent_to_tech` finds its own value and sends
   * nothing, a second press of the button brings a new one and sends again.
   * Absent for `new-job-sms`, which keys on `scheduledDate`.
   */
  sentFor?: string;
  conversationId: string;
  messageId: string;
  sentAt: string;
}

/**
 * `AUTOSENT#<dealId>` / `<ruleId>#<techId>` — the idempotency ledger of the
 * per-job automations (design §4.9 for automations). The `CLIENTMSG#`
 * guard on the send itself expires after 7 days; this row does not, so a
 * `deal.updated` for a notes edit months later never re-sends "New job",
 * while a changed `scheduledDate` does. Written after the send succeeded
 * (or was found to be a duplicate), so a crash in between is healed by
 * the next delivery through the `CLIENTMSG#` guard.
 */
@Injectable()
export class AutoSentRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(dealId: string, ruleId: string, techId: string): Promise<AutoSentMarker | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: autoSentPk(dealId), SK: autoSentSk(ruleId, techId) },
      }),
    );
    return res.Item ? stripKeys<AutoSentMarker>(res.Item) : null;
  }

  /** Unconditional Put — the latest send for the pair wins. */
  async put(marker: AutoSentMarker): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: autoSentPk(marker.dealId),
          SK: autoSentSk(marker.ruleId, marker.techId),
          ...compact(marker as unknown as Record<string, unknown>),
          scheduledDate: marker.scheduledDate, // keep '' explicit: "sent for an unscheduled job"
        },
      }),
    );
  }
}
