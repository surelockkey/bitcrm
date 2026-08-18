import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CallGroup } from '@bitcrm/types';
import {
  CALL_GROUPS_TABLE,
  CALL_GROUP_PK,
  callGroupSk,
} from './call-groups.constants';

/**
 * Groups are stored whole — members included. A group is tens of rows at most,
 * so there is no partial-update race worth designing around, and one write
 * either lands or doesn't: a half-saved membership can't ring half a team.
 */
@Injectable()
export class CallGroupsRepository {
  private readonly logger = new Logger(CallGroupsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(group: CallGroup): Record<string, unknown> {
    return { PK: CALL_GROUP_PK, SK: callGroupSk(group.id), ...group };
  }

  async listAll(): Promise<CallGroup[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: CALL_GROUPS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': CALL_GROUP_PK },
      }),
    );
    return (result.Items ?? []) as CallGroup[];
  }

  async get(id: string): Promise<CallGroup | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALL_GROUPS_TABLE,
        Key: { PK: CALL_GROUP_PK, SK: callGroupSk(id) },
      }),
    );
    return (result.Item as CallGroup) ?? null;
  }

  /** Insert; fails if the id is somehow taken. */
  async create(group: CallGroup): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALL_GROUPS_TABLE,
        Item: this.item(group),
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    this.logger.log(`Created call group ${group.id} (${group.name})`);
  }

  /** Full replace of an existing group. */
  async put(group: CallGroup): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: CALL_GROUPS_TABLE, Item: this.item(group) }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: CALL_GROUPS_TABLE,
        Key: { PK: CALL_GROUP_PK, SK: callGroupSk(id) },
      }),
    );
    this.logger.log(`Deleted call group ${id}`);
  }
}
