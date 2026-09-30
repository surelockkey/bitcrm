import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import type { Invoice } from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_GSI4_NAME,
  BILLING_TABLE,
  INVOICES_GSI1PK,
  UNPAID_GSI4PK,
  UNPAID_INDEX_STATE_PK,
  UNPAID_INDEX_STATE_SK,
  stripKeys,
} from '../common/constants/dynamo.constants';

/** How long a "not built yet" answer is trusted before the state row is read again. */
const NOT_READY_RECHECK_MS = 60_000;

/**
 * The open invoices — every invoice that still owes money (`due` or
 * `overdue`) — as the billing reports and the overdue sweep need them.
 *
 *   GSI4 (UnpaidIndex): GSI4PK = UNPAID, GSI4SK = <invoiceId>   sparse, ~600 rows
 *   UNPAIDINDEX / STATE  { readyAt, count }   written by `backfill:unpaid-index`
 *
 * The index keys ride on the invoice row itself (`InvoicesRepository` sets
 * and clears them with `status`), so the index is always as fresh as the
 * rows. What it cannot know on its own is whether the rows written BEFORE it
 * existed have been stamped: until the backfill has written the state row,
 * `listUnpaid` answers from the full invoice list instead (a filtered read of
 * all ~78 000 rows — slow, never wrong) and says so (`indexReady: false`).
 */
@Injectable()
export class UnpaidInvoicesRepository {
  private ready = false;
  private checkedAt = 0;

  constructor(private readonly db: DynamoDbService) {}

  /** Has `backfill:unpaid-index` run here? Once yes, never asked again by this process. */
  async isReady(): Promise<boolean> {
    if (this.ready) return true;
    if (Date.now() - this.checkedAt < NOT_READY_RECHECK_MS) return false;
    const res = await this.db.client.send(
      new GetCommand({
        TableName: BILLING_TABLE,
        Key: { PK: UNPAID_INDEX_STATE_PK, SK: UNPAID_INDEX_STATE_SK },
      }),
    );
    this.checkedAt = Date.now();
    this.ready = Boolean(res.Item?.readyAt);
    return this.ready;
  }

  /** Every open invoice (order unspecified), and where the answer came from. */
  async listUnpaid(): Promise<{ items: Invoice[]; indexReady: boolean }> {
    if (await this.isReady()) {
      return { items: await this.readIndex(), indexReady: true };
    }
    return { items: await this.readListFiltered(), indexReady: false };
  }

  /** Stamped by the backfill after every row carries its keys. */
  async markReady(count: number, at: string = new Date().toISOString()): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: {
          PK: UNPAID_INDEX_STATE_PK,
          SK: UNPAID_INDEX_STATE_SK,
          entityType: 'unpaid_index_state',
          readyAt: at,
          count,
        },
      }),
    );
    this.ready = true;
  }

  private async readIndex(): Promise<Invoice[]> {
    const out: Invoice[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          ExpressionAttributeValues: { ':pk': UNPAID_GSI4PK },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) out.push(stripKeys<Invoice>(item)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /** The pre-index answer: the whole list, filtered by status on the server. */
  private async readListFiltered(): Promise<Invoice[]> {
    const out: Invoice[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: '#status IN (:due, :overdue)',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': INVOICES_GSI1PK, ':due': 'due', ':overdue': 'overdue' },
          ExclusiveStartKey,
        }),
      );
      for (const item of res.Items ?? []) out.push(stripKeys<Invoice>(item)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }
}
