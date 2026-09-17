import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { DocumentTemplate } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_TABLE,
  METADATA_SK,
  TEMPLATES_GSI1PK,
  listSk,
  stripKeys,
  templatePk,
} from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';

export class TemplateVersionConflictError extends Error {
  constructor() {
    super('Template version conflict');
  }
}

/**
 * Document templates.
 *
 *   PK = TEMPLATE#<id>, SK = METADATA
 *   GSI1 (ListIndex): GSI1PK = TEMPLATES, GSI1SK = <createdAt>#<id>
 *
 * Tens of rows — the catalog partition is read whole.
 */
@Injectable()
export class TemplatesRepository {
  constructor(private readonly db: DynamoDbService) {}

  private item(t: DocumentTemplate) {
    return {
      PK: templatePk(t.id),
      SK: METADATA_SK,
      GSI1PK: TEMPLATES_GSI1PK,
      GSI1SK: listSk(t.createdAt, t.id),
      entityType: 'template',
      ...t,
    };
  }

  async list(): Promise<DocumentTemplate[]> {
    const out: DocumentTemplate[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': TEMPLATES_GSI1PK },
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(stripKeys<DocumentTemplate>(i)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  async get(id: string): Promise<DocumentTemplate | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: templatePk(id), SK: METADATA_SK } }),
    );
    return stripKeys<DocumentTemplate>(res.Item);
  }

  /** Idempotent insert; `false` when the id already exists. */
  async createIfAbsent(t: DocumentTemplate): Promise<boolean> {
    try {
      await this.db.client.send(
        new PutCommand({
          TableName: BILLING_TABLE,
          Item: this.item(t),
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /** Full replace guarded by the stored version (`expectedVersion`). */
  async replace(t: DocumentTemplate, expectedVersion: number): Promise<void> {
    try {
      await this.db.client.send(
        new PutCommand({
          TableName: BILLING_TABLE,
          Item: this.item(t),
          ConditionExpression: 'attribute_exists(PK) AND #v = :expected',
          ExpressionAttributeNames: { '#v': 'version' },
          ExpressionAttributeValues: { ':expected': expectedVersion },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new TemplateVersionConflictError();
      throw err;
    }
  }

  /** Makes `id` the only default among `others` (same kind), atomically. */
  async setDefault(id: string, others: string[], now: string): Promise<void> {
    const flag = (tid: string, value: boolean) => ({
      Update: {
        TableName: BILLING_TABLE,
        Key: { PK: templatePk(tid), SK: METADATA_SK },
        UpdateExpression: 'SET isDefault = :v, updatedAt = :now, #version = #version + :one',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#version': 'version' },
        ExpressionAttributeValues: { ':v': value, ':now': now, ':one': 1 },
      },
    });
    const items = [flag(id, true), ...others.filter((o) => o !== id).map((o) => flag(o, false))];
    // A transaction holds at most 100 items; a kind never has that many defaults to clear.
    await this.db.client.send(new TransactWriteCommand({ TransactItems: items.slice(0, 100) }));
  }

  async delete(id: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: templatePk(id), SK: METADATA_SK } }),
    );
  }
}
