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
import { type DealProduct, type DealProductFulfillment } from '@bitcrm/types';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';

@Injectable()
export class DealProductsRepository {
  private tableName = DEALS_TABLE;

  constructor(private readonly dynamoDb: DynamoDbService) {}

  async addProduct(dealId: string, product: DealProduct): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${product.productId}`,
          ...product,
        },
      }),
    );
  }

  async removeProduct(dealId: string, productId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${productId}`,
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

  /** Mark a to-order line as ordered (or clear it when `orderedAt` is null). */
  async setOrderedAt(
    dealId: string,
    productId: string,
    orderedAt: string | null,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `PRODUCT#${productId}` },
        UpdateExpression:
          orderedAt === null ? 'REMOVE orderedAt' : 'SET orderedAt = :o',
        ...(orderedAt !== null && {
          ExpressionAttributeValues: { ':o': orderedAt },
        }),
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  async findProduct(dealId: string, productId: string): Promise<DealProduct | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          PK: `DEAL#${dealId}`,
          SK: `PRODUCT#${productId}`,
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
    Array<{ dealId: string; productId: string }>
  > {
    const rows: Array<{ dealId: string; productId: string }> = [];
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
          productId: item.productId as string,
        });
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return rows;
  }

  async setFulfillment(
    dealId: string,
    productId: string,
    fulfillment: DealProductFulfillment,
  ): Promise<void> {
    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: `DEAL#${dealId}`, SK: `PRODUCT#${productId}` },
        UpdateExpression: 'SET fulfillment = :f',
        ExpressionAttributeValues: { ':f': fulfillment },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
  }

  private toProduct(item: Record<string, unknown>): DealProduct {
    return {
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
      orderedAt: item.orderedAt as string | undefined,
      addedBy: item.addedBy as string,
      addedAt: item.addedAt as string,
    };
  }
}
