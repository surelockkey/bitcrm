import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type AutomationRun } from '@bitcrm/types';
import {
  MESSAGING_TABLE,
  METADATA_SK,
  MESSAGING_TTL_ATTRIBUTE,
  automationPk,
} from '../../common/constants/dynamo.constants';
import { compact, epochSeconds, stripKeys } from '../../common/items';
import { isConditionalCheckFailed } from '../../common/dynamo-errors';
import {
  AUTO_ONCE_TTL_SECONDS,
  AUTO_RUN_SK_PREFIX,
  AUTO_RUN_TTL_SECONDS,
  autoOnceSk,
  autoRunPk,
  autoRunSk,
} from '../automations.constants';

/**
 * The firing log and the idempotency ledger of the rule engine
 * (`AUTORUN#<ruleId>`, design §3.2 + §4.9):
 *
 *   claim()  writes `ONCE#<entity>#<occurrence>` with `attribute_not_exists`
 *            — the first caller wins, everyone after it is a duplicate. This
 *            is what makes an SQS redelivery, a replayed queue or two
 *            instances racing send one message, not three.
 *   log()    appends `RUN#<firedAt>#<runId>` — what the Automation Center's
 *            "last firings" list and the test-run dialog read.
 *   bump()   moves `firedCount` / `lastFiredAt` on the rule itself with an
 *            atomic ADD, so the counter survives a concurrent rule edit.
 *
 * Both run items carry a TTL: the log is history, not an audit trail.
 */
@Injectable()
export class AutomationRunsRepository {
  private readonly logger = new Logger(AutomationRunsRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `true` when this firing is ours to run; `false` when someone already ran it. */
  async claim(
    ruleId: string,
    entity: string,
    occurrence: string,
    at: string = new Date().toISOString(),
  ): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: autoRunPk(ruleId),
            SK: autoOnceSk(entity, occurrence),
            ruleId,
            entity,
            occurrence,
            claimedAt: at,
            [MESSAGING_TTL_ATTRIBUTE]: epochSeconds(at) + AUTO_ONCE_TTL_SECONDS,
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

  /**
   * Gives a claim back — used when the firing could not even be attempted
   * (the job vanished, the queue was down) so the next delivery may retry.
   * Never called after an action ran: a half-sent firing must not repeat.
   */
  async release(ruleId: string, entity: string, occurrence: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: autoRunPk(ruleId), SK: autoOnceSk(entity, occurrence) },
      }),
    );
  }

  /** Appends one firing to the rule's log. Best-effort: a lost log line never fails a send. */
  async log(run: AutomationRun): Promise<AutomationRun> {
    const item = {
      PK: autoRunPk(run.ruleId),
      SK: autoRunSk(run.firedAt, run.id),
      ...compact(run as unknown as Record<string, unknown>),
      [MESSAGING_TTL_ATTRIBUTE]: run.expiresAt ?? epochSeconds(run.firedAt) + AUTO_RUN_TTL_SECONDS,
    };
    await this.dynamoDb.client.send(new PutCommand({ TableName: this.tableName, Item: item }));
    return run;
  }

  /** The rule's firings, newest first. */
  async listByRule(ruleId: string, limit = 20): Promise<AutomationRun[]> {
    const res = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': autoRunPk(ruleId), ':sk': AUTO_RUN_SK_PREFIX },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return (res.Items ?? []).map((i) => stripKeys<AutomationRun>(i, [MESSAGING_TTL_ATTRIBUTE]));
  }

  /** `firedCount += 1`, `lastFiredAt = at` on `AUTOMATION#<ruleId>` — atomic, never a read-modify-write. */
  async bump(ruleId: string, at: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { PK: automationPk(ruleId), SK: METADATA_SK },
          UpdateExpression: 'ADD firedCount :one SET lastFiredAt = :at',
          ExpressionAttributeValues: { ':one': 1, ':at': at },
          // A built-in rule nobody has edited has no row yet; its counter
          // starts the day it is first switched on or edited.
          ConditionExpression: 'attribute_exists(PK)',
        }),
      );
    } catch (error) {
      if (isConditionalCheckFailed(error)) return;
      this.logger.warn(`Firing counter for ${ruleId} not updated: ${error instanceof Error ? error.message : error}`);
    }
  }
}
