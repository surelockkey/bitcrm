import { Injectable } from '@nestjs/common';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContainerTemplateFillResult } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

/** How long a fill's request id is remembered. */
const CLAIM_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface TemplateFillClaimInput {
  requestId: string;
  templateId: string;
  containerId: string;
  warehouseId: string;
  userId: string;
}

export interface TemplateFillClaim extends TemplateFillClaimInput {
  status: 'pending' | 'done';
  /** The fill's answer, stored once it moved, so a retry gets it back. */
  result?: ContainerTemplateFillResult;
  createdAt: string;
  expiresAt: number;
}

const key = (requestId: string) => ({ PK: `IDEMPOTENCY#TEMPLATE_FILL#${requestId}`, SK: 'METADATA' });

const isConditionFailure = (error: unknown) =>
  error instanceof Error && error.name === 'ConditionalCheckFailedException';

/**
 * One row per "Fill from warehouse" request, so a double submit moves stock
 * once:
 *   PK = IDEMPOTENCY#TEMPLATE_FILL#<requestId>, SK = METADATA
 *   { requestId, templateId, containerId, warehouseId, userId, status, result?,
 *     createdAt, expiresAt }
 * Claimed with a conditional Put before anything moves, completed with the
 * answer after, released (deleted) if the fill failed so a retry can run.
 * `expiresAt` is epoch seconds, 7 days on: the inventory table has no TTL
 * attribute configured yet (infra/dev/data_plane.tf), so the rows stay until
 * it is — they are small and one per click.
 */
@Injectable()
export class TemplateFillClaimsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** True when this request id was free and is now claimed; false when it was already claimed. */
  async claim(input: TemplateFillClaimInput): Promise<boolean> {
    const now = Date.now();
    try {
      await this.dynamoDb.client.send(
        new PutCommand({
          TableName: INVENTORY_TABLE,
          Item: {
            ...key(input.requestId),
            ...input,
            status: 'pending',
            createdAt: new Date(now).toISOString(),
            expiresAt: Math.floor(now / 1000) + CLAIM_TTL_SECONDS,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  async find(requestId: string): Promise<TemplateFillClaim | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: INVENTORY_TABLE, Key: key(requestId) }),
    );
    if (!result.Item) return null;
    const { PK: _pk, SK: _sk, ...claim } = result.Item;
    return claim as TemplateFillClaim;
  }

  async complete(requestId: string, result: ContainerTemplateFillResult): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: key(requestId),
        UpdateExpression: 'SET #status = :done, #result = :result',
        ExpressionAttributeNames: { '#status': 'status', '#result': 'result' },
        // Plain data: no class instances, no undefined values.
        ExpressionAttributeValues: { ':done': 'done', ':result': JSON.parse(JSON.stringify(result)) },
      }),
    );
  }

  /** Frees a pending claim after a failed fill; a completed one is never released. */
  async release(requestId: string): Promise<void> {
    try {
      await this.dynamoDb.client.send(
        new DeleteCommand({
          TableName: INVENTORY_TABLE,
          Key: key(requestId),
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pending': 'pending' },
        }),
      );
    } catch (error: unknown) {
      if (!isConditionFailure(error)) throw error;
    }
  }
}
