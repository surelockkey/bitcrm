import { Injectable } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { MESSAGING_TABLE, MESSAGING_TTL_ATTRIBUTE, METADATA_SK } from '../common/constants/dynamo.constants';
import { conditionFailedAt, isConditionalCheckFailed } from '../common/dynamo-errors';
import { epochSeconds } from '../common/items';
import {
  PUSH_SENT_TTL_SECONDS,
  PUSH_USER_TOKEN_SK_PREFIX,
  pushSentPk,
  pushTokenPk,
  pushUserPk,
  pushUserTokenSk,
  type PushPlatform,
} from './push.constants';

/** One registered device. */
export interface PushTokenRow {
  token: string;
  userId: string;
  platform: PushPlatform;
  createdAt: string;
  updatedAt: string;
}

/** How many times a registration re-reads after another sign-in took the token in between. */
const MAX_ATTEMPTS = 3;

/**
 * The push tables, all in the messaging table (no GSI keys on any row):
 *
 *   PUSHTOKEN#<token>     / METADATA        { token, userId, platform, createdAt, updatedAt } — the owner
 *   PUSHUSER#<userId>     / TOKEN#<token>   { token, userId, platform, createdAt, updatedAt } — the user's devices
 *   PUSHSENT#<occurrence> / METADATA        { occurrence, claimedAt, expiresAt } — once-per-event claim (TTL)
 *
 * A token has one owner. `register` writes both token rows in one
 * transaction guarded on the owner it read, deleting the previous owner's
 * row when the token changes hands; a lost race re-reads and tries again.
 */
@Injectable()
export class PushRepository {
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async register(userId: string, token: string, platform: PushPlatform, at: string = new Date().toISOString()): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const owner = await this.owner(token);
      const sameUser = owner?.userId === userId;
      const row: PushTokenRow = { token, userId, platform, createdAt: sameUser ? owner.createdAt : at, updatedAt: at };
      try {
        await this.dynamoDb.client.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: this.tableName,
                  Item: { PK: pushTokenPk(token), SK: METADATA_SK, entityType: 'push_token', ...row },
                  ...(owner
                    ? { ConditionExpression: 'userId = :prev', ExpressionAttributeValues: { ':prev': owner.userId } }
                    : { ConditionExpression: 'attribute_not_exists(PK)' }),
                },
              },
              {
                Put: {
                  TableName: this.tableName,
                  Item: { PK: pushUserPk(userId), SK: pushUserTokenSk(token), entityType: 'push_user_token', ...row },
                },
              },
              ...(owner && !sameUser
                ? [{ Delete: { TableName: this.tableName, Key: { PK: pushUserPk(owner.userId), SK: pushUserTokenSk(token) } } }]
                : []),
            ],
          }),
        );
        return;
      } catch (err) {
        if (!conditionFailedAt(err, 0) || attempt >= MAX_ATTEMPTS) throw err;
      }
    }
  }

  /**
   * Sign-out, or a token Expo reports dead: the owner row goes only if this
   * user still owns it, the user's own row goes regardless (it may be a
   * leftover of a token that has since moved on).
   */
  async unregister(userId: string, token: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: pushTokenPk(token), SK: METADATA_SK },
          ConditionExpression: 'userId = :me',
          ExpressionAttributeValues: { ':me': userId },
        }),
      );
    } catch (err) {
      if (!isConditionalCheckFailed(err)) throw err;
    }
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: this.tableName, Key: { PK: pushUserPk(userId), SK: pushUserTokenSk(token) } }),
    );
  }

  async tokensFor(userId: string): Promise<PushTokenRow[]> {
    const rows: PushTokenRow[] = [];
    let startKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': pushUserPk(userId), ':sk': PUSH_USER_TOKEN_SK_PREFIX },
          ExclusiveStartKey: startKey,
        }),
      );
      for (const item of res.Items ?? []) rows.push(toRow(item));
      startKey = res.LastEvaluatedKey;
    } while (startKey);
    return rows;
  }

  /** `true` the first time an occurrence is claimed, `false` ever after (until the TTL sweeps it). */
  async claim(occurrence: string, at: string = new Date().toISOString()): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            PK: pushSentPk(occurrence),
            SK: METADATA_SK,
            occurrence,
            claimedAt: at,
            [MESSAGING_TTL_ATTRIBUTE]: epochSeconds(at) + PUSH_SENT_TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  private async owner(token: string): Promise<PushTokenRow | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({ TableName: this.tableName, Key: { PK: pushTokenPk(token), SK: METADATA_SK } }),
    );
    return res.Item ? toRow(res.Item) : null;
  }
}

function toRow(item: Record<string, unknown>): PushTokenRow {
  return {
    token: String(item.token),
    userId: String(item.userId),
    platform: item.platform as PushPlatform,
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? ''),
  };
}
