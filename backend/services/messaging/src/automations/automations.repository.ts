import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type AutomationRule } from '@bitcrm/types';
import {
  MESSAGING_GSI3_NAME,
  MESSAGING_TABLE,
  METADATA_SK,
  automationPk,
} from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';
import { AUTOMATION_CATALOG_GSI3PK, automationCatalogSk } from './automations.constants';

/**
 * Automation rules in the messaging table (design §3.2):
 *
 *   AUTOMATION#<id> / METADATA   the rule (imported Workiz rows keep their structure as-is)
 *                                GSI3PK = CATALOG#AUTOMATION, GSI3SK = <name lower>#<id>
 *
 * Whole-document Put, like settings: the rules are edited one at a time on
 * the settings page and have no independent writers. Listing walks the
 * GSI3 catalog partition (tens of rows) — no Scan, no FilterExpression.
 * Nothing is seeded here; imported rules arrive through the history loader
 * and the built-in ones live in `builtin-rules.ts` until first edited.
 */
@Injectable()
export class AutomationsRepository {
  private readonly logger = new Logger(AutomationsRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** `GetItem AUTOMATION#<id>`. */
  async get(id: string): Promise<AutomationRule | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: automationPk(id), SK: METADATA_SK },
      }),
    );
    return res.Item ? this.toEntity(res.Item) : null;
  }

  /** `Query CategoryIndex GSI3PK = CATALOG#AUTOMATION`, alphabetical, every page. */
  async list(): Promise<AutomationRule[]> {
    const items: AutomationRule[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: MESSAGING_GSI3_NAME,
          KeyConditionExpression: 'GSI3PK = :pk',
          ExpressionAttributeValues: { ':pk': AUTOMATION_CATALOG_GSI3PK },
          ScanIndexForward: true,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      items.push(...(res.Items ?? []).map((i) => this.toEntity(i)));
      exclusiveStartKey = res.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return items;
  }

  /** `Put AUTOMATION#<id>` — replaces the document and (re)stamps the catalog keys. */
  async put(rule: AutomationRule): Promise<AutomationRule> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: automationPk(rule.id),
          SK: METADATA_SK,
          GSI3PK: AUTOMATION_CATALOG_GSI3PK,
          GSI3SK: automationCatalogSk(rule.name, rule.id),
          ...compact(rule as unknown as Record<string, unknown>),
        },
      }),
    );
    this.logger.log(`Automation rule ${rule.id} saved (enabled=${rule.enabled})`);
    return rule;
  }

  /**
   * `Delete AUTOMATION#<id>` — the rule row and, with it, its place in the
   * GSI3 catalog. The rule's `AUTORUN#<id>` firings are deliberately left
   * behind: they are history with a 30-day TTL, DynamoDB reaps them for
   * free, and fanning out a Query + BatchWrite over a partition that can
   * hold thousands of rows (the busiest Workiz rule fired 17 476 times) to
   * delete what is about to expire anyway would be a lot of writes for
   * nothing. Nothing reads them once the rule is gone: both the per-rule
   * log and the account feed list runs of rules that still exist.
   */
  async delete(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: automationPk(id), SK: METADATA_SK },
      }),
    );
    this.logger.log(`Automation rule ${id} deleted`);
  }

  private toEntity(item: Record<string, unknown>): AutomationRule {
    const r = stripKeys<AutomationRule>(item);
    return { ...r, enabled: r.enabled === true, ...(r.builtin === true ? { builtin: true } : {}) };
  }
}
