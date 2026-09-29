import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  DEFAULT_PAYMENT_SETTINGS,
  type Payment,
  type PaymentMethod,
  type PaymentRefund,
  type PaymentSettings,
  type PaymentStatus,
} from '@bitcrm/types';
import {
  BILLING_GSI1_NAME,
  BILLING_GSI2_NAME,
  BILLING_TABLE,
  METADATA_SK,
  PAYMENTS_GSI1PK,
  PAYMENT_SETTINGS_SK,
  PAYMENT_SK_PREFIX,
  REFUND_SK_PREFIX,
  SETTINGS_PK,
  STRIPE_POINTER_SK,
  WEBHOOK_EVENT_TTL_DAYS,
  contactGsi2Pk,
  contactGsi2Sk,
  invoicePaymentSk,
  invoicePk,
  listSk,
  paymentPk,
  refundSk,
  stripePointerPk,
  stripKeys,
  webhookEventPk,
} from '../common/constants/dynamo.constants';
import { decodeCursor, encodeCursor } from '../common/cursor';
import { isConditionalCheckFailed, isTransactionCanceled } from '../common/dynamo-errors';
import { buildUpdate } from '../common/update-expression';

export class PaymentVersionConflictError extends Error {
  constructor() {
    super('Payment version conflict');
    this.name = 'PaymentVersionConflictError';
  }
}

export interface PaymentListFilter {
  from?: string;
  to?: string;
  method?: PaymentMethod;
  status?: PaymentStatus;
  contactId?: string;
  limit: number;
  cursor?: string;
}

/**
 * The payment ledger.
 *
 *   PK = PAYMENT#<paymentId>, SK = METADATA          the canonical row
 *     GSI1 (ListIndex):    GSI1PK = PAYMENTS,            GSI1SK = <createdAt>#<id>
 *     GSI2 (ContactIndex): GSI2PK = CONTACT#<contactId>, GSI2SK = PAYMENT#<createdAt>#<id>
 *   PK = INVOICE#<dealId>,  SK = PAYMENT#<createdAt>#<paymentId>
 *                                                    the same payment, adjacent to its
 *                                                    invoice: one Query reads a job's
 *                                                    ledger next to the invoice row
 *   PK = PAYMENT#<paymentId>, SK = REFUND#<createdAt>#<refundId>
 *   PK = STRIPE#<objectId>,   SK = POINTER           → {paymentId}; one per session,
 *                                                    intent and charge id, so a webhook
 *                                                    resolves its payment in ONE read
 *   PK = WEBHOOK#<eventId>,   SK = METADATA          dedupe, TTL on `expiresAt`
 *   PK = SETTINGS,            SK = PAYMENTS          the PaymentSettings singleton
 *
 * The two copies of a payment are written in one TransactWrite, so the
 * adjacency row can never drift from the canonical one. Every status change
 * is conditional on the row's `version`.
 */
@Injectable()
export class PaymentsRepository {
  constructor(private readonly db: DynamoDbService) {}

  // ------------------------------------------------------------- ledger rows

  private canonicalItem(p: Payment) {
    return {
      PK: paymentPk(p.id),
      SK: METADATA_SK,
      GSI1PK: PAYMENTS_GSI1PK,
      GSI1SK: listSk(p.createdAt, p.id),
      GSI2PK: contactGsi2Pk(p.contactId),
      GSI2SK: contactGsi2Sk('PAYMENT', p.createdAt, p.id),
      entityType: 'payment',
      ...p,
    };
  }

  private adjacentItem(p: Payment) {
    return {
      PK: invoicePk(p.invoiceId),
      SK: invoicePaymentSk(p.createdAt, p.id),
      entityType: 'payment',
      ...p,
    };
  }

  async create(payment: Payment): Promise<Payment> {
    await this.db.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: BILLING_TABLE,
              Item: this.canonicalItem(payment),
              ConditionExpression: 'attribute_not_exists(PK)',
            },
          },
          { Put: { TableName: BILLING_TABLE, Item: this.adjacentItem(payment) } },
        ],
      }),
    );
    return payment;
  }

  async get(paymentId: string): Promise<Payment | null> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: paymentPk(paymentId), SK: METADATA_SK } }),
    );
    return stripKeys<Payment>(res.Item);
  }

  /** A job's whole ledger, oldest first — one Query in the invoice's partition. */
  async listByInvoice(invoiceId: string): Promise<Payment[]> {
    const out: Payment[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': invoicePk(invoiceId), ':sk': PAYMENT_SK_PREFIX },
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(stripKeys<Payment>(i)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  /**
   * Partial update of BOTH copies, atomically. `expectedVersion` makes the
   * write refuse when someone (a webhook, the sweep, a user) got there first —
   * the caller re-reads and re-asserts rather than blindly retrying.
   */
  async update(
    payment: Pick<Payment, 'id' | 'invoiceId' | 'createdAt' | 'version'>,
    set: Partial<Payment> & Record<string, unknown>,
    remove: string[] = [],
    opts: { expectedVersion?: number } = {},
  ): Promise<Payment> {
    const patch = { ...set };
    delete patch.version;
    const expr = buildUpdate(patch, remove, { incrementVersion: true });
    // The version check lives ONLY on the canonical row. DynamoDB rejects an
    // Update whose ExpressionAttributeNames carry an entry no expression uses,
    // so the adjacency row gets the plain expression.
    const guarded =
      opts.expectedVersion === undefined
        ? { ...expr, ConditionExpression: 'attribute_exists(PK)' }
        : {
            ...expr,
            ExpressionAttributeNames: { ...expr.ExpressionAttributeNames, '#ev': 'version' },
            ExpressionAttributeValues: { ...expr.ExpressionAttributeValues, ':ev': opts.expectedVersion },
            ConditionExpression: 'attribute_exists(PK) AND #ev = :ev',
          };
    try {
      await this.db.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: BILLING_TABLE,
                Key: { PK: paymentPk(payment.id), SK: METADATA_SK },
                ...guarded,
              },
            },
            {
              Update: {
                TableName: BILLING_TABLE,
                Key: { PK: invoicePk(payment.invoiceId), SK: invoicePaymentSk(payment.createdAt, payment.id) },
                ...expr,
                ConditionExpression: 'attribute_exists(PK)',
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (isConditionalCheckFailed(err) || isTransactionCanceled(err)) throw new PaymentVersionConflictError();
      throw err;
    }
    const fresh = await this.get(payment.id);
    if (!fresh) throw new PaymentVersionConflictError();
    return fresh;
  }

  /** Both copies, plus the Stripe pointers. Offline payments only (the service enforces that). */
  async delete(payment: Pick<Payment, 'id' | 'invoiceId' | 'createdAt'>): Promise<void> {
    await this.db.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: BILLING_TABLE, Key: { PK: paymentPk(payment.id), SK: METADATA_SK } } },
          {
            Delete: {
              TableName: BILLING_TABLE,
              Key: { PK: invoicePk(payment.invoiceId), SK: invoicePaymentSk(payment.createdAt, payment.id) },
            },
          },
        ],
      }),
    );
  }

  // ------------------------------------------------------------------- lists

  async list(filter: PaymentListFilter): Promise<{ items: Payment[]; nextCursor?: string }> {
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const filters: string[] = [];
    let input: QueryCommandInput;

    if (filter.contactId) {
      values[':pk'] = contactGsi2Pk(filter.contactId);
      values[':prefix'] = 'PAYMENT#';
      input = {
        TableName: BILLING_TABLE,
        IndexName: BILLING_GSI2_NAME,
        KeyConditionExpression: 'GSI2PK = :pk AND begins_with(GSI2SK, :prefix)',
      };
      if (filter.from) {
        names['#createdAt'] = 'createdAt';
        values[':from'] = filter.from;
        filters.push('#createdAt >= :from');
      }
      if (filter.to) {
        names['#createdAt'] = 'createdAt';
        values[':to'] = `${filter.to}~`;
        filters.push('#createdAt <= :to');
      }
    } else {
      values[':pk'] = PAYMENTS_GSI1PK;
      let key = 'GSI1PK = :pk';
      if (filter.from && filter.to) {
        values[':from'] = filter.from;
        values[':to'] = `${filter.to}~`;
        key += ' AND GSI1SK BETWEEN :from AND :to';
      } else if (filter.from) {
        values[':from'] = filter.from;
        key += ' AND GSI1SK >= :from';
      } else if (filter.to) {
        values[':to'] = `${filter.to}~`;
        key += ' AND GSI1SK <= :to';
      }
      input = { TableName: BILLING_TABLE, IndexName: BILLING_GSI1_NAME, KeyConditionExpression: key };
    }

    if (filter.status) {
      names['#status'] = 'status';
      values[':status'] = filter.status;
      filters.push('#status = :status');
    }
    if (filter.method) {
      names['#method'] = 'method';
      values[':method'] = filter.method;
      filters.push('#method = :method');
    }

    const items: Payment[] = [];
    let startKey = decodeCursor<Record<string, unknown>>(filter.cursor);
    const query: QueryCommandInput = {
      ...input,
      ScanIndexForward: false,
      ExpressionAttributeValues: values,
      ...(Object.keys(names).length && { ExpressionAttributeNames: names }),
      ...(filters.length && { FilterExpression: filters.join(' AND ') }),
    };
    for (let round = 0; round < 25 && items.length < filter.limit; round++) {
      const res = await this.db.client.send(
        new QueryCommand({ ...query, Limit: filter.limit - items.length, ExclusiveStartKey: startKey }),
      );
      for (const i of res.Items ?? []) items.push(stripKeys<Payment>(i)!);
      startKey = res.LastEvaluatedKey;
      if (!startKey) break;
    }
    return { items, nextCursor: startKey ? encodeCursor(startKey) : undefined };
  }

  /**
   * EVERY payment matching a filter, paged internally — the report strip's
   * Collected / Clearing / Refunded totals must cover the whole range, not
   * the page. Same tradeoff as the invoice summary: one constant list
   * partition plus a FilterExpression, fine at one-invoice-per-job volumes.
   */
  async listAllMatching(filter: Omit<PaymentListFilter, 'limit' | 'cursor'>): Promise<Payment[]> {
    const out: Payment[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.list({ ...filter, limit: 500, cursor });
      out.push(...page.items);
      cursor = page.nextCursor;
      // A guard against an unbounded read if the ledger ever does grow.
    } while (cursor && out.length < 20_000);
    return out;
  }

  /** Every payment that has not reached a terminal state — the reconciliation sweep. */
  async listNonTerminal(): Promise<Payment[]> {
    const out: Payment[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const res = await this.db.client.send(
        new QueryCommand({
          TableName: BILLING_TABLE,
          IndexName: BILLING_GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          FilterExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': PAYMENTS_GSI1PK, ':pending': 'pending' },
          ExclusiveStartKey,
        }),
      );
      for (const i of res.Items ?? []) out.push(stripKeys<Payment>(i)!);
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  // ----------------------------------------------------------------- refunds

  async addRefund(refund: PaymentRefund): Promise<PaymentRefund> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: {
          PK: paymentPk(refund.paymentId),
          SK: refundSk(refund.createdAt, refund.id),
          entityType: 'payment_refund',
          ...refund,
        },
      }),
    );
    return refund;
  }

  async listRefunds(paymentId: string): Promise<PaymentRefund[]> {
    const res = await this.db.client.send(
      new QueryCommand({
        TableName: BILLING_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': paymentPk(paymentId), ':sk': REFUND_SK_PREFIX },
      }),
    );
    return (res.Items ?? []).map((i) => stripKeys<PaymentRefund>(i)!);
  }

  async updateRefund(refund: Pick<PaymentRefund, 'id' | 'paymentId' | 'createdAt'>, set: Record<string, unknown>) {
    const expr = buildUpdate(set, []);
    await this.db.client.send(
      new UpdateCommand({
        TableName: BILLING_TABLE,
        Key: { PK: paymentPk(refund.paymentId), SK: refundSk(refund.createdAt, refund.id) },
        ...expr,
      }),
    );
  }

  // ---------------------------------------------------------- stripe lookups

  /** `STRIPE#<id>` → paymentId. Written for the session, the intent and the charge. */
  async putStripePointer(stripeObjectId: string, paymentId: string): Promise<void> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: {
          PK: stripePointerPk(stripeObjectId),
          SK: STRIPE_POINTER_SK,
          entityType: 'stripe_pointer',
          paymentId,
          stripeObjectId,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }

  async findPaymentIdByStripeObject(stripeObjectId: string): Promise<string | null> {
    const res = await this.db.client.send(
      new GetCommand({
        TableName: BILLING_TABLE,
        Key: { PK: stripePointerPk(stripeObjectId), SK: STRIPE_POINTER_SK },
      }),
    );
    return (res.Item?.paymentId as string | undefined) ?? null;
  }

  /**
   * Claims a Stripe event id. `false` means this exact event was already
   * handled — the caller answers 200 and does nothing. The row expires after
   * 30 days via the table's `expiresAt` TTL.
   */
  async claimWebhookEvent(eventId: string, type: string): Promise<boolean> {
    try {
      await this.db.client.send(
        new PutCommand({
          TableName: BILLING_TABLE,
          Item: {
            PK: webhookEventPk(eventId),
            SK: METADATA_SK,
            entityType: 'stripe_webhook_event',
            eventId,
            type,
            receivedAt: new Date().toISOString(),
            expiresAt: Math.floor(Date.now() / 1000) + WEBHOOK_EVENT_TTL_DAYS * 86_400,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        }),
      );
      return true;
    } catch (err) {
      if (isConditionalCheckFailed(err)) return false;
      throw err;
    }
  }

  /** Lets a failed handler be retried: the claim is released so Stripe's retry lands. */
  async releaseWebhookEvent(eventId: string): Promise<void> {
    await this.db.client.send(
      new DeleteCommand({ TableName: BILLING_TABLE, Key: { PK: webhookEventPk(eventId), SK: METADATA_SK } }),
    );
  }

  // ---------------------------------------------------------------- settings

  async getSettings(): Promise<PaymentSettings> {
    const res = await this.db.client.send(
      new GetCommand({ TableName: BILLING_TABLE, Key: { PK: SETTINGS_PK, SK: PAYMENT_SETTINGS_SK } }),
    );
    const stored = stripKeys<Partial<PaymentSettings>>(res.Item);
    return { ...DEFAULT_PAYMENT_SETTINGS, ...(stored ?? {}) };
  }

  async putSettings(settings: PaymentSettings): Promise<PaymentSettings> {
    await this.db.client.send(
      new PutCommand({
        TableName: BILLING_TABLE,
        Item: { PK: SETTINGS_PK, SK: PAYMENT_SETTINGS_SK, entityType: 'payment_settings', ...settings },
      }),
    );
    return settings;
  }
}
