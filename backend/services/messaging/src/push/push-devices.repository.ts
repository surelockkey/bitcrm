import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type PushDevice } from '@bitcrm/types';
import {
  MESSAGING_GSI3_NAME,
  MESSAGING_TABLE,
  MESSAGING_TTL_ATTRIBUTE,
  METADATA_SK,
  PUSH_DEVICE_TTL_SECONDS,
  pushDeviceOfGsi3Pk,
  pushDeviceOfGsi3Sk,
  pushDevicePk,
} from '../common/constants/dynamo.constants';
import { compact, stripKeys } from '../common/items';

/**
 * The push registry:
 *
 *   DEVICE#<token> / METADATA
 *   GSI3PK = DEVICEOF#<userId>, GSI3SK = <registeredAt>#<token>
 *
 * A constant-partition adjacency on the existing CategoryIndex, exactly like
 * the template catalog and `MEMBEROF#` — no new index (CLAUDE.md §5). The
 * token is the partition key, so registering the same token twice refreshes
 * one row instead of growing a list, and a phone that changes hands moves to
 * its new owner rather than being pushed both people's jobs.
 *
 * Rows carry the table's `expiresAt` TTL, refreshed by every registration
 * (the app registers on each launch), so a phone nobody has opened for
 * `PUSH_DEVICE_TTL_SECONDS` stops being written to on its own.
 */
@Injectable()
export class PushDevicesRepository {
  private readonly logger = new Logger(PushDevicesRepository.name);
  private tableName = MESSAGING_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  /**
   * Register or refresh one token. `registeredAt` is kept from the existing
   * row so it keeps meaning "since when has this phone been signed in",
   * while `lastSeenAt` and the TTL move forward every time.
   */
  async register(
    input: Pick<PushDevice, 'token' | 'userId' | 'platform' | 'appVersion' | 'deviceName'>,
    at: string = new Date().toISOString(),
  ): Promise<PushDevice> {
    const existing = await this.get(input.token);
    const sameOwner = existing?.userId === input.userId;
    const device: PushDevice = {
      token: input.token,
      userId: input.userId,
      platform: input.platform,
      appVersion: input.appVersion,
      deviceName: input.deviceName,
      registeredAt: sameOwner && existing ? existing.registeredAt : at,
      lastSeenAt: at,
    };

    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: pushDevicePk(device.token),
          SK: METADATA_SK,
          GSI3PK: pushDeviceOfGsi3Pk(device.userId),
          GSI3SK: pushDeviceOfGsi3Sk(device.registeredAt, device.token),
          ...compact(device as unknown as Record<string, unknown>),
          [MESSAGING_TTL_ATTRIBUTE]: expiryOf(at),
        },
      }),
    );
    if (existing && !sameOwner) {
      this.logger.log(`Push device moved from user ${existing.userId} to ${device.userId}`);
    }
    return device;
  }

  async get(token: string): Promise<PushDevice | null> {
    const res = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: pushDevicePk(token), SK: METADATA_SK },
      }),
    );
    return res.Item ? stripKeys<PushDevice>(res.Item, [MESSAGING_TTL_ATTRIBUTE]) : null;
  }

  /** `Query CategoryIndex GSI3PK = DEVICEOF#<userId>` — every phone one person carries. */
  async listByUser(userId: string): Promise<PushDevice[]> {
    const devices: PushDevice[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: MESSAGING_GSI3_NAME,
          KeyConditionExpression: 'GSI3PK = :pk',
          ExpressionAttributeValues: { ':pk': pushDeviceOfGsi3Pk(userId) },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      devices.push(...(res.Items ?? []).map((i) => stripKeys<PushDevice>(i, [MESSAGING_TTL_ATTRIBUTE])));
      exclusiveStartKey = res.LastEvaluatedKey;
    } while (exclusiveStartKey);
    return devices;
  }

  /** Every phone of every listed user, in one pass — what a notifier pushes to. */
  async listByUsers(userIds: readonly string[]): Promise<PushDevice[]> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const perUser = await Promise.all(unique.map((id) => this.listByUser(id)));
    return perUser.flat();
  }

  /**
   * The user's own unregister (sign-out): conditional on the row still being
   * theirs, so knowing somebody else's token is not enough to silence their
   * phone. A token that is gone, or was never theirs, is not an error — the
   * caller's intent ("this phone must stop receiving") already holds.
   */
  async removeForUser(token: string, userId: string): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { PK: pushDevicePk(token), SK: METADATA_SK },
          ConditionExpression: 'attribute_exists(PK) AND userId = :userId',
          ExpressionAttributeValues: { ':userId': userId },
        }),
      );
      return true;
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') return false;
      throw error;
    }
  }

  /**
   * Expo says the token is dead (`DeviceNotRegistered`). No owner check: the
   * push service is acting on the provider's word about the token itself,
   * and leaving it would mean pushing into the void on every job.
   */
  async remove(token: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { PK: pushDevicePk(token), SK: METADATA_SK },
      }),
    );
  }
}

/** TTL is epoch seconds, `PUSH_DEVICE_TTL_SECONDS` from the last registration. */
export function expiryOf(at: string): number {
  return Math.floor(new Date(at).getTime() / 1000) + PUSH_DEVICE_TTL_SECONDS;
}
