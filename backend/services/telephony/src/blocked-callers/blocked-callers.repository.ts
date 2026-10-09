import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type BlockedCaller } from '@bitcrm/types';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';
import { BLOCKED_CALLERS_PK, blockedCallerSk } from './blocked-callers.constants';

/**
 * Blocked-caller rows in the calls table:
 *   PK = BLOCKED#ALL, SK = <E.164>
 *
 * A row is a handful of scalars with no edit path: it is created once
 * (conditionally, so blocking a number twice is a conflict rather than a
 * silent rewrite of the first comment) and deleted on unblock.
 */
@Injectable()
export class BlockedCallersRepository {
  private readonly logger = new Logger(BlockedCallersRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(row: BlockedCaller): Record<string, unknown> {
    return { PK: BLOCKED_CALLERS_PK, SK: blockedCallerSk(row.number), ...row };
  }

  /**
   * The whole list, walking the partition to its end. Read consistently: the
   * number a dispatcher just blocked must be on the very next inbound check,
   * and the partition is hundreds of rows, not thousands.
   */
  async listAll(): Promise<BlockedCaller[]> {
    const out: BlockedCaller[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: CALLS_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': BLOCKED_CALLERS_PK },
          ConsistentRead: true,
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      for (const item of result.Items ?? []) out.push(this.toEntity(item));
      cursor = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (cursor);
    return out;
  }

  async get(number: string): Promise<BlockedCaller | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALLS_TABLE,
        Key: { PK: BLOCKED_CALLERS_PK, SK: blockedCallerSk(number) },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Insert; fails (ConditionalCheckFailedException) when the number is already blocked. */
  async create(row: BlockedCaller): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: this.item(row),
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    this.logger.log(`Blocked ${row.number}`);
  }

  /** Delete the row; true when there was one. */
  async remove(number: string): Promise<boolean> {
    const result = await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: CALLS_TABLE,
        Key: { PK: BLOCKED_CALLERS_PK, SK: blockedCallerSk(number) },
        ReturnValues: 'ALL_OLD',
      }),
    );
    const existed = !!result.Attributes;
    if (existed) this.logger.log(`Unblocked ${number}`);
    return existed;
  }

  /**
   * Tolerant of rows written by the importer: `id` falls back to the number,
   * an empty comment is absent, `createdBy` defaults to the import.
   */
  private toEntity(item: Record<string, unknown>): BlockedCaller {
    const number = (item.number as string) ?? (item.SK as string) ?? '';
    const comment = typeof item.comment === 'string' ? item.comment.trim() : '';
    return {
      id: (item.id as string) ?? number,
      number,
      ...(comment ? { comment } : {}),
      ...(item.externalId ? { externalId: item.externalId as string } : {}),
      createdBy: (item.createdBy as string) ?? 'import',
      createdAt: (item.createdAt as string) ?? '',
    };
  }
}
