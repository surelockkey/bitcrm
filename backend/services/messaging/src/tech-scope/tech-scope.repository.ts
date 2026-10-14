import { Injectable } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  MESSAGING_TABLE,
  TECH_SCOPE_PK,
  TECH_SCOPE_SK_PREFIX,
  TECH_SCOPE_STATE_PK,
  TECH_SCOPE_STATE_SK,
  techScopeSk,
} from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';
import { type TechScopeDeal } from './tech-scope.logic';

/** One technician's stored inbox scope. */
export interface TechScopeRow {
  userId: string;
  /** The jobs that open client threads for them, in deal-service's by-tech order. */
  deals: TechScopeDeal[];
  /** When the by-tech read this row was built from STARTED — the write guard. */
  computedAt: string;
  /** How many jobs by-tech answered (before the roster filter); 100 = it may have been cut. */
  dealCount: number;
}

export interface TechScopeState {
  readyAt: string;
  count: number;
}

/**
 * The technician inbox projection (see `TechScopeService`):
 *
 *   PK TECHSCOPE        SK USER#<userId>   { userId, deals: [{id, contactId?, companyId?}],
 *                                            contactIds: [..] (for a CRM merge's filter),
 *                                            computedAt, dealCount }
 *   PK TECHSCOPEINDEX   SK STATE           { readyAt, count } — the readiness gate
 *
 * No GSI keys: a request reads its row by key; only the backfill and a
 * contact merge walk the partition (tens to a few hundred rows).
 */
@Injectable()
export class TechScopeRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async get(userId: string): Promise<TechScopeRow | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: TECH_SCOPE_PK, SK: techScopeSk(userId) } }),
    );
    return res.Item ? toRow(res.Item) : null;
  }

  /**
   * Writes the row unless a NEWER computation already did: guarded on
   * `computedAt`, so two events racing for one technician end with the
   * answer that was read last. `expectComputedAt` instead demands the row be
   * exactly the one read (a merge's rewrite of an existing row). `false`
   * when the guard refused.
   */
  async put(row: TechScopeRow, opts: { expectComputedAt?: string } = {}): Promise<boolean> {
    const contactIds = [...new Set(row.deals.map((d) => d.contactId).filter((id): id is string => !!id))];
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: TECH_SCOPE_PK,
            SK: techScopeSk(row.userId),
            entityType: 'tech_scope',
            userId: row.userId,
            deals: row.deals,
            contactIds,
            computedAt: row.computedAt,
            dealCount: row.dealCount,
          },
          ...(opts.expectComputedAt
            ? {
                ConditionExpression: 'computedAt = :prev',
                ExpressionAttributeValues: { ':prev': opts.expectComputedAt },
              }
            : {
                ConditionExpression: 'attribute_not_exists(PK) OR computedAt <= :at',
                ExpressionAttributeValues: { ':at': row.computedAt },
              }),
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  async delete(userId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK: TECH_SCOPE_PK, SK: techScopeSk(userId) } }),
    );
  }

  /** Every row — the backfill's reconcile. */
  async listAll(): Promise<TechScopeRow[]> {
    return this.query();
  }

  /** The rows that hold a job with this contact — a CRM merge rewrites them. */
  async listByContact(contactId: string): Promise<TechScopeRow[]> {
    return this.query({ expression: 'contains(contactIds, :c)', values: { ':c': contactId } });
  }

  async getState(): Promise<TechScopeState | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: TECH_SCOPE_STATE_PK, SK: TECH_SCOPE_STATE_SK } }),
    );
    if (!res.Item?.readyAt) return null;
    return { readyAt: String(res.Item.readyAt), count: Number(res.Item.count ?? 0) };
  }

  async putState(state: TechScopeState): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { PK: TECH_SCOPE_STATE_PK, SK: TECH_SCOPE_STATE_SK, entityType: 'tech_scope_state', ...state },
      }),
    );
  }

  private async query(filter?: { expression: string; values: Record<string, unknown> }): Promise<TechScopeRow[]> {
    const rows: TechScopeRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': TECH_SCOPE_PK, ':sk': TECH_SCOPE_SK_PREFIX, ...(filter?.values ?? {}) },
          ...(filter && { FilterExpression: filter.expression }),
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) rows.push(toRow(item));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return rows;
  }
}

function toRow(item: Record<string, unknown>): TechScopeRow {
  return {
    userId: String(item.userId),
    deals: Array.isArray(item.deals) ? (item.deals as TechScopeDeal[]) : [],
    computedAt: String(item.computedAt ?? ''),
    dealCount: Number(item.dealCount ?? 0),
  };
}
