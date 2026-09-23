import { Injectable } from '@nestjs/common';
import {
  PutCommand,
  DeleteCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import {
  type DealProduct,
  type DealProductFulfillment,
  type DealProductPriceSource,
} from '@bitcrm/types';
import { randomUUID } from 'crypto';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

/**
 * A job's lines: `PK = DEAL#<dealId>`, `SK = PRODUCT#<lineId>`.
 *
 * The key is the LINE's id, not the product's, so one job can carry the same
 * product on two lines. Rows written before that read their key back as the
 * `lineId` (it was the `productId`), which keeps every stored link, URL and
 * cached row addressing the same line — so `lineKey` below is simply
 * "whatever identifies this line", old or new.
 */
/** A line as a caller writes it: the id is optional, and minted when absent. */
export type DealProductDraft = Omit<DealProduct, 'lineId'> & { lineId?: string };

@Injectable()
export class DealProductsRepository {
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async addProduct(dealId: string, product: DealProductDraft): Promise<void> {
    // The importer brings its own line id; everything else gets one here.
    const lineId = product.lineId || randomUUID();
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${lineId}`,
          ...product,
          lineId,
        },
      }),
    );
  }

  async removeProduct(dealId: string, lineKey: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${lineKey}`,
        },
      }),
    );
  }

  async findByDeal(dealId: string): Promise<DealProduct[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `DEAL#${dealId}`,
          ':sk': 'PRODUCT#',
        },
      }),
    );

    return (result.Items || []).map((i) => this.toProduct(i));
  }

  /** Number of line items on a deal (drives `Deal.itemCount`). */
  async countByDeal(dealId: string): Promise<number> {
    let count = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `DEAL#${dealId}`, ':sk': 'PRODUCT#' },
          Select: 'COUNT',
          ExclusiveStartKey: lastKey,
        }),
      );
      count += result.Count ?? 0;
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return count;
  }

  /** Toggle whether the job's tax applies to a line; 404-style failure if the line is gone. */
  async setTaxable(dealId: string, lineKey: string, taxable: boolean): Promise<DealProduct> {
    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `PRODUCT#${lineKey}` },
        UpdateExpression: 'SET taxable = :t',
        ExpressionAttributeValues: { ':t': taxable },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toProduct(result.Attributes!);
  }

  /** Mark a to-order line as ordered (or clear it when `orderedAt` is null). */
  async setOrderedAt(
    dealId: string,
    lineKey: string,
    orderedAt: string | null,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `PRODUCT#${lineKey}` },
        UpdateExpression:
          orderedAt === null ? 'REMOVE orderedAt' : 'SET orderedAt = :o',
        ...(orderedAt !== null && {
          ExpressionAttributeValues: { ':o': orderedAt },
        }),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async findProduct(dealId: string, lineKey: string): Promise<DealProduct | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${lineKey}`,
        },
      }),
    );

    if (!result.Item) return null;
    return this.toProduct(result.Item);
  }

  /**
   * Scan every deal-product row that predates the `fulfillment` field. Used by
   * the boot-time backfill; filters server-side so it only returns rows that
   * still need stamping (idempotent). Paginates the full table.
   */
  async listRowsMissingFulfillment(): Promise<
    Array<{ dealId: string; lineKey: string }>
  > {
    const rows: Array<{ dealId: string; lineKey: string }> = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression:
            'begins_with(SK, :sk) AND attribute_not_exists(fulfillment)',
          ExpressionAttributeValues: { ':sk': 'PRODUCT#' },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of result.Items || []) {
        rows.push({
          dealId: (item.PK as string).replace('DEAL#', ''),
          // The key the row actually lives under, whichever era wrote it.
          lineKey: (item.SK as string).replace('PRODUCT#', ''),
        });
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return rows;
  }

  async setFulfillment(
    dealId: string,
    lineKey: string,
    fulfillment: DealProductFulfillment,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `PRODUCT#${lineKey}` },
        UpdateExpression: 'SET fulfillment = :f',
        ExpressionAttributeValues: { ':f': fulfillment },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  private toProduct(item: Record<string, unknown>): DealProduct {
    return {
      // A row written before line ids was keyed by its product, so that is
      // the id every stored reference to it already uses.
      lineId: (item.lineId as string | undefined) ?? (item.productId as string),
      productId: item.productId as string,
      name: item.name as string,
      sku: item.sku as string,
      quantity: item.quantity as number,
      costCompany: item.costCompany as number,
      costForTech: item.costForTech as number,
      priceClient: item.priceClient as number,
      // Rows written before these fields existed omit them; a missing
      // `fulfillment` means the line was pulled from a technician (`sourced`).
      sourceTechId: item.sourceTechId as string | undefined,
      fulfillment:
        (item.fulfillment as DealProductFulfillment | undefined) ?? 'sourced',
      // Only the Workiz importer sets this; left undefined it means "the
      // catalog/override flow wrote this line" and the ±15% band applies.
      priceSource: item.priceSource as DealProductPriceSource | undefined,
      orderedAt: item.orderedAt as string | undefined,
      // Legacy lines predate billing: an absent flag means taxable (Workiz default).
      taxable: item.taxable !== false,
      description: item.description as string | undefined,
      addedBy: item.addedBy as string,
      addedAt: item.addedAt as string,
      updatedBy: item.updatedBy as string | undefined,
      updatedAt: item.updatedAt as string | undefined,
    };
  }
}
