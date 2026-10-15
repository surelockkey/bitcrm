import { Injectable } from '@nestjs/common';
import { QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { AdminAuditEntry } from '@bitcrm/types';
import { USERS_TABLE } from '../users/constants/dynamo.constants';
import { adminAuditActorPk, adminAuditMonthPk, adminAuditTargetPk } from './admin-audit.constants';

const KEY_ATTRIBUTES = new Set(['PK', 'SK']);

/**
 * The admin trail, beside the people it is about. Each entry lands in three
 * partitions at once (see `admin-audit.constants.ts`):
 *
 *   ADMINAUDIT#<YYYY-MM>              / <at>#<id>   the month's log
 *   ADMINAUDIT#<USER|ROLE>#<targetId> / <at>#<id>   the subject's history
 *   ADMINAUDIT#ACTOR#<actorId>        / <at>#<id>   the actor's history
 *
 * Append-only; no GSI keys, and the users listing reads `USER#` rows only.
 */
@Injectable()
export class AdminAuditRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async record(entry: AdminAuditEntry): Promise<void> {
    const SK = `${entry.at}#${entry.id}`;
    const pks = [
      adminAuditMonthPk(entry.at.slice(0, 7)),
      adminAuditTargetPk(entry.targetType, entry.targetId),
      adminAuditActorPk(entry.actorId),
    ];
    await this.dynamoDb.client.send(
      new TransactWriteCommand({
        TransactItems: pks.map((PK) => ({
          Put: { TableName: USERS_TABLE, Item: { PK, SK, ...entry } },
        })),
      }),
    );
  }

  /** One partition, newest first. */
  async page(
    pk: string,
    limit: number,
    startKey?: Record<string, unknown>,
  ): Promise<{ items: AdminAuditEntry[]; lastKey?: Record<string, unknown> }> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: USERS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ScanIndexForward: false,
        Limit: limit,
        ...(startKey && { ExclusiveStartKey: startKey }),
      }),
    );
    return {
      items: (result.Items ?? []).map(
        (item) =>
          Object.fromEntries(Object.entries(item).filter(([k]) => !KEY_ATTRIBUTES.has(k))) as AdminAuditEntry,
      ),
      lastKey: result.LastEvaluatedKey,
    };
  }
}
