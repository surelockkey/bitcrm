import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type UserContainer } from '@bitcrm/types';
import {
  INVENTORY_TABLE,
  GSI1_NAME,
  GSI3_NAME,
} from '../common/constants/dynamo.constants';
import {
  CONTAINER_USERS_PK_PREFIX,
  USER_CONTAINER_GSI1PK,
  USER_CONTAINER_PK_PREFIX,
  USER_CONTAINER_SK,
  userContainerItem,
} from './user-containers.constants';

/** Key attributes that must never leak into an entity. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

/**
 * User container assignments (Workiz "User containers") in the single
 * BitCRM_Inventory table, one row per user:
 *   PK = USER_CONTAINER#<userId>, SK = METADATA
 *   GSI1PK = CATALOG#USER_CONTAINER, GSI1SK = <userName trimmed lowercased>#<userId>
 *     (the list, name order)
 *   GSI3PK = CONTAINER_USERS#<containerId>, GSI3SK = USER#<userId>
 *     (sparse, OwnerIndex: only `access: container` rows — who works from a van)
 * `put` replaces the whole row, so moving a user to "All locations" or "No
 * access" drops the GSI3 pair with it.
 */
@Injectable()
export class UserContainersRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async put(row: UserContainer): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: INVENTORY_TABLE, Item: userContainerItem(row) }),
    );
  }

  async findByUser(userId: string): Promise<UserContainer | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${USER_CONTAINER_PK_PREFIX}${userId}`, SK: USER_CONTAINER_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Every assignment, in name order. */
  async listAll(): Promise<UserContainer[]> {
    return this.queryAll(GSI1_NAME, 'GSI1PK', USER_CONTAINER_GSI1PK);
  }

  /** The users whose one container is this one. */
  async listByContainer(containerId: string): Promise<UserContainer[]> {
    return this.queryAll(GSI3_NAME, 'GSI3PK', `${CONTAINER_USERS_PK_PREFIX}${containerId}`);
  }

  private async queryAll(
    indexName: string,
    keyAttr: 'GSI1PK' | 'GSI3PK',
    pk: string,
  ): Promise<UserContainer[]> {
    const rows: UserContainer[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const page = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: indexName,
          KeyConditionExpression: `${keyAttr} = :pk`,
          ExpressionAttributeValues: { ':pk': pk },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      for (const item of page.Items ?? []) rows.push(this.toEntity(item));
      key = page.LastEvaluatedKey;
    } while (key);
    return rows;
  }

  private toEntity(item: Record<string, unknown>): UserContainer {
    const entity: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (!KEY_ATTRIBUTES.has(key)) entity[key] = value;
    }
    return { ...entity, limited: item.limited === true } as unknown as UserContainer;
  }
}
