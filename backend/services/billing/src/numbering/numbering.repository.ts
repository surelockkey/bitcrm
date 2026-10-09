import { Injectable } from '@nestjs/common';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { ACCOUNT_COUNTERS_PK, BILLING_TABLE, COUNTERS_SK } from '../common/constants/dynamo.constants';
import { isConditionalCheckFailed } from '../common/dynamo-errors';

/** Which counter: a client invoice's or a client estimate's. */
export type NumberingKind = 'invoice' | 'estimate';

/** The attribute on the counters row that holds the LAST number handed out. */
export const LAST_NUMBER_ATTRIBUTE: Record<NumberingKind, 'lastInvoiceNumber' | 'lastEstimateNumber'> = {
  invoice: 'lastInvoiceNumber',
  estimate: 'lastEstimateNumber',
};

/**
 * `COUNTERS#ACCOUNT` / `COUNTERS` as the numbering reads it. `documentSeq` is
 * the legacy shared counter (numbers were `1000 + documentSeq`); it is never
 * moved again, only read as the floor the new counters start from.
 */
export interface AccountCountersRow {
  documentSeq?: number;
  lastInvoiceNumber?: number;
  lastEstimateNumber?: number;
  numberingUpdatedBy?: string;
  numberingUpdatedAt?: string;
}

/** The "next number" being set is not above a number already handed out. */
export class NumberingBehindError extends Error {
  constructor(public readonly kind: NumberingKind) {
    super(`The next ${kind} number is already past the one being set`);
    this.name = 'NumberingBehindError';
  }
}

/**
 * The counters row's numbering attributes, each change one conditional
 * UpdateItem:
 *
 *   allocate   SET n = if_not_exists(n, :seed) + 1 — atomic; when the attribute
 *              is not there yet the seed (the legacy floor) stands in for it, so
 *              the first number is seed + 1 and two concurrent first callers
 *              still get two numbers.
 *   setLast    SET n = :last IF attribute_not_exists(n) OR n <= :last — a number
 *              handed out while the office typed is never set below
 *              (`NumberingBehindError`).
 */
@Injectable()
export class NumberingRepository {
  constructor(private readonly db: DynamoDbService) {}

  async read(): Promise<AccountCountersRow> {
    const res = await this.db.client.send(
      new GetCommand({
        TableName: BILLING_TABLE,
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        ConsistentRead: true,
      }),
    );
    const item = (res.Item ?? {}) as Record<string, unknown>;
    const row: AccountCountersRow = {};
    for (const k of ['documentSeq', 'lastInvoiceNumber', 'lastEstimateNumber'] as const) {
      if (typeof item[k] === 'number') row[k] = item[k] as number;
    }
    for (const k of ['numberingUpdatedBy', 'numberingUpdatedAt'] as const) {
      if (typeof item[k] === 'string') row[k] = item[k] as string;
    }
    return row;
  }

  /** The next number of `kind`; `seed` is what the counter starts from when it has never been used. */
  async allocate(kind: NumberingKind, seed: number): Promise<number> {
    const attribute = LAST_NUMBER_ATTRIBUTE[kind];
    const res = await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
        UpdateExpression: 'SET #n = if_not_exists(#n, :seed) + :one',
        ExpressionAttributeNames: { '#n': attribute },
        ExpressionAttributeValues: { ':seed': seed, ':one': 1 },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(res.Attributes?.[attribute]);
  }

  /** Makes `last + 1` the next number of `kind`, unless a higher number is already out. */
  async setLast(kind: NumberingKind, last: number, updatedBy: string, updatedAt: string): Promise<void> {
    try {
      await this.db.client.send(
        new UpdateCommand({
          TableName: BILLING_TABLE,
          Key: { PK: ACCOUNT_COUNTERS_PK, SK: COUNTERS_SK },
          UpdateExpression: 'SET #n = :last, numberingUpdatedBy = :by, numberingUpdatedAt = :at',
          ConditionExpression: 'attribute_not_exists(#n) OR #n <= :last',
          ExpressionAttributeNames: { '#n': LAST_NUMBER_ATTRIBUTE[kind] },
          ExpressionAttributeValues: { ':last': last, ':by': updatedBy, ':at': updatedAt },
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err)) throw new NumberingBehindError(kind);
      throw err;
    }
  }
}
