import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CallFlow } from '@bitcrm/types';
import {
  CALL_FLOWS_TABLE,
  CALL_FLOW_PK,
  callFlowSk,
} from './call-flows.constants';

/**
 * Flows are stored whole. A flow is tens of nodes at most, and a half-written
 * one is a broken phone line — one write either lands or it doesn't.
 */
@Injectable()
export class CallFlowsRepository {
  private readonly logger = new Logger(CallFlowsRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(flow: CallFlow): Record<string, unknown> {
    return { PK: CALL_FLOW_PK, SK: callFlowSk(flow.id), ...flow };
  }

  async listAll(): Promise<CallFlow[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: CALL_FLOWS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': CALL_FLOW_PK },
      }),
    );
    return (result.Items ?? []) as CallFlow[];
  }

  async get(id: string): Promise<CallFlow | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALL_FLOWS_TABLE,
        Key: { PK: CALL_FLOW_PK, SK: callFlowSk(id) },
      }),
    );
    return (result.Item as CallFlow) ?? null;
  }

  async create(flow: CallFlow): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALL_FLOWS_TABLE,
        Item: this.item(flow),
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    this.logger.log(`Created call flow ${flow.id} (${flow.name})`);
  }

  async put(flow: CallFlow): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: CALL_FLOWS_TABLE, Item: this.item(flow) }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: CALL_FLOWS_TABLE,
        Key: { PK: CALL_FLOW_PK, SK: callFlowSk(id) },
      }),
    );
    this.logger.log(`Deleted call flow ${id}`);
  }
}
