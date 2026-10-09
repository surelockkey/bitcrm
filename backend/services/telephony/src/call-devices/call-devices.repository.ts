import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CallDevice } from '@bitcrm/types';
import { CALLS_TABLE } from '../common/constants/dynamo.constants';
import { CALL_DEVICE_PK, callDeviceSk } from './call-devices.constants';

/** Devices are stored whole — a name and a number is one write. */
@Injectable()
export class CallDevicesRepository {
  private readonly logger = new Logger(CallDevicesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(device: CallDevice): Record<string, unknown> {
    return { PK: CALL_DEVICE_PK, SK: callDeviceSk(device.id), ...device };
  }

  /** The stored shape without its keys — what the API returns. */
  private entity(item: Record<string, unknown>): CallDevice {
    const { PK: _pk, SK: _sk, ...rest } = item;
    return rest as unknown as CallDevice;
  }

  async listAll(): Promise<CallDevice[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: CALLS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': CALL_DEVICE_PK },
      }),
    );
    return (result.Items ?? []).map((i) => this.entity(i as Record<string, unknown>));
  }

  async get(id: string): Promise<CallDevice | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: CALLS_TABLE,
        Key: { PK: CALL_DEVICE_PK, SK: callDeviceSk(id) },
      }),
    );
    return result.Item ? this.entity(result.Item as Record<string, unknown>) : null;
  }

  /** Insert; fails if the id is somehow taken. */
  async create(device: CallDevice): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: CALLS_TABLE,
        Item: this.item(device),
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    this.logger.log(`Created device ${device.id} (${device.name})`);
  }

  /** Full replace of an existing device. */
  async put(device: CallDevice): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: CALLS_TABLE, Item: this.item(device) }),
    );
  }

  async delete(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: CALLS_TABLE,
        Key: { PK: CALL_DEVICE_PK, SK: callDeviceSk(id) },
      }),
    );
    this.logger.log(`Deleted device ${id}`);
  }
}
