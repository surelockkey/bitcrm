import { ServiceUnavailableException } from '@nestjs/common';
import { BatchGetCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { INVENTORY_TABLE } from '../constants/dynamo.constants';

/** BatchGet takes at most 100 keys a call. */
const BATCH_GET_SIZE = 100;

/**
 * BatchGet hands keys back unprocessed when the table is throttled, and the
 * SDK does not retry them (the call succeeded). A few attempts with a doubling
 * pause, then the request fails instead of hammering the table until the
 * load balancer times it out.
 */
const BATCH_GET_ATTEMPTS = 5;
const BATCH_GET_BACKOFF_MS = 50;

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every row of the inventory table the keys name, 100 keys a call, asking
 * again for the unprocessed ones a bounded number of times (503 after that).
 * A key with no row is simply absent from the answer; order is not kept.
 */
export async function batchGetAll(
  client: Pick<DynamoDBDocumentClient, 'send'>,
  allKeys: Array<Record<string, unknown>>,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < allKeys.length; i += BATCH_GET_SIZE) {
    let keys = allKeys.slice(i, i + BATCH_GET_SIZE);
    for (let attempt = 0; keys.length; attempt++) {
      if (attempt >= BATCH_GET_ATTEMPTS) {
        throw new ServiceUnavailableException('Inventory read throttled; try again');
      }
      if (attempt > 0) await pause(BATCH_GET_BACKOFF_MS * 2 ** (attempt - 1));
      const res = await client.send(
        new BatchGetCommand({ RequestItems: { [INVENTORY_TABLE]: { Keys: keys } } }),
      );
      rows.push(...((res.Responses?.[INVENTORY_TABLE] ?? []) as Record<string, unknown>[]));
      keys = (res.UnprocessedKeys?.[INVENTORY_TABLE]?.Keys ?? []) as typeof keys;
    }
  }
  return rows;
}
