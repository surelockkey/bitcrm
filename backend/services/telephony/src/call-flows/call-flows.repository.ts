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
import { LocalTtlCache } from '../common/local-ttl-cache';

/** How long another task may route by a flow list from before this one's write. */
export const CALL_FLOWS_CACHE_TTL_MS = 30_000;

/**
 * Flows are stored whole. A flow is tens of nodes at most, and a half-written
 * one is a broken phone line — one write either lands or it doesn't.
 *
 * `listAll` is cached in process for 30 s (single-flight) because it sits on
 * hot paths: `GET /call-flows`, every inbound call (`findByNumber`) and every
 * call-record write (the company of the flow answering the number). This
 * task's own create / put / delete drop it at once; other tasks catch up
 * within the TTL — so a flow edit can take up to 30 s to route calls on every
 * task. `get(id)` stays a direct read.
 */
@Injectable()
export class CallFlowsRepository {
  private readonly logger = new Logger(CallFlowsRepository.name);
  private readonly listCache = new LocalTtlCache<CallFlow[]>(CALL_FLOWS_CACHE_TTL_MS);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(flow: CallFlow): Record<string, unknown> {
    return { PK: CALL_FLOW_PK, SK: callFlowSk(flow.id), ...flow };
  }

  async listAll(): Promise<CallFlow[]> {
    const flows = await this.listCache.get(async () => {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: CALL_FLOWS_TABLE,
          KeyConditionExpression: 'PK = :pk',
          ExpressionAttributeValues: { ':pk': CALL_FLOW_PK },
        }),
      );
      return (result.Items ?? []) as CallFlow[];
    });
    // A deep copy: `list()` sorts in place and callers edit flows they read.
    return structuredClone(flows);
  }

  /** Run a write, dropping the list cache whether or not it succeeded. */
  private async writing<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } finally {
      this.listCache.invalidate();
    }
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
    await this.writing(() =>
      this.dynamoDb.client.send(
        new PutCommand({
          TableName: CALL_FLOWS_TABLE,
          Item: this.item(flow),
          ConditionExpression: 'attribute_not_exists(SK)',
        }),
      ),
    );
    this.logger.log(`Created call flow ${flow.id} (${flow.name})`);
  }

  async put(flow: CallFlow): Promise<void> {
    await this.writing(() =>
      this.dynamoDb.client.send(
        new PutCommand({ TableName: CALL_FLOWS_TABLE, Item: this.item(flow) }),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    await this.writing(() =>
      this.dynamoDb.client.send(
        new DeleteCommand({
          TableName: CALL_FLOWS_TABLE,
          Key: { PK: CALL_FLOW_PK, SK: callFlowSk(id) },
        }),
      ),
    );
    this.logger.log(`Deleted call flow ${id}`);
  }
}
