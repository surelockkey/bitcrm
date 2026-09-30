import { Injectable, Logger } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ItemAttribute } from '@bitcrm/types';
import { INVENTORY_TABLE, GSI1_NAME, GSI4_NAME } from '../common/constants/dynamo.constants';
import { PRODUCT_CATALOG_INDEX_PK } from '../products/product-catalog-index';
import {
  CUSTOM_ATTRIBUTES_FIELD,
  ITEM_ATTRIBUTE_GSI1PK,
  ITEM_ATTRIBUTE_PK_PREFIX,
  ITEM_ATTRIBUTE_SK,
} from './item-attributes.constants';

/** Key attributes that must never leak into an entity or be re-put verbatim. */
const KEY_ATTRIBUTES = new Set([
  'PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'GSI4PK', 'GSI4SK',
]);

/** A product row as the custom-field walk reads it: its id and its values. */
export interface ProductAttributeRow {
  id: string;
  customAttributes: Record<string, unknown>;
}

function isConditionFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

/**
 * Custom field definitions (`ITEM_ATTRIBUTE#<id>`), plus the two product
 * writes a definition change needs. Values sit on the product under the
 * definition NAME (`customAttributes[<name>]`), so a rename moves the key and
 * a delete removes it on every product that has one.
 *
 * The stored type attribute is `attrType` (what the importer writes); the
 * entity calls it `type`. Attributes the importer adds (`externalId`,
 * `orphan`…) are carried through `get` and `put`.
 */
@Injectable()
export class ItemAttributesRepository {
  private readonly logger = new Logger(ItemAttributesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(attribute: ItemAttribute): Record<string, unknown> {
    const { type, ...rest } = attribute;
    return {
      ...rest,
      attrType: type,
      PK: `${ITEM_ATTRIBUTE_PK_PREFIX}${attribute.id}`,
      SK: ITEM_ATTRIBUTE_SK,
      GSI1PK: ITEM_ATTRIBUTE_GSI1PK,
      GSI1SK: attribute.name.toLowerCase(),
    };
  }

  /** Insert a new definition; fails if the id already exists. */
  async create(attribute: ItemAttribute): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: this.item(attribute),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created custom field ${attribute.id} (${attribute.name})`);
  }

  /** Full replace of an existing definition (the update path). */
  async put(attribute: ItemAttribute): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: INVENTORY_TABLE, Item: this.item(attribute) }),
    );
  }

  async get(id: string): Promise<ItemAttribute | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${ITEM_ATTRIBUTE_PK_PREFIX}${id}`, SK: ITEM_ATTRIBUTE_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /** Every definition — a Query of the catalog partition to its end, never a Scan. */
  async listAll(): Promise<ItemAttribute[]> {
    const rows: Record<string, unknown>[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI1_NAME,
          KeyConditionExpression: 'GSI1PK = :pk',
          ExpressionAttributeValues: { ':pk': ITEM_ATTRIBUTE_GSI1PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      rows.push(...(result.Items ?? []));
      key = result.LastEvaluatedKey;
    } while (key);
    return rows.map((row) => this.toEntity(row));
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${ITEM_ATTRIBUTE_PK_PREFIX}${id}`, SK: ITEM_ATTRIBUTE_SK },
      }),
    );
    this.logger.log(`Deleted custom field ${id}`);
  }

  /**
   * Walks every product holding a value under `name`, a page at a time, and
   * hands each page to `onPage` before reading the next. Reads the Price Book
   * partition (GSI4 `PRODUCTS#ALL`, every product) with a filter on the key —
   * a Query, not a Scan of the ~46k-row table. Rows not yet filed by
   * `backfill:product-catalog-index` are not seen. Answers how many matched.
   */
  async forEachProductWithAttribute(
    name: string,
    onPage: (rows: ProductAttributeRow[]) => Promise<void>,
  ): Promise<number> {
    let matched = 0;
    let key: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: INVENTORY_TABLE,
          IndexName: GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          FilterExpression: 'attribute_exists(#ca.#name)',
          ProjectionExpression: 'id, #ca',
          ExpressionAttributeNames: { '#ca': CUSTOM_ATTRIBUTES_FIELD, '#name': name },
          ExpressionAttributeValues: { ':pk': PRODUCT_CATALOG_INDEX_PK },
          ...(key ? { ExclusiveStartKey: key } : {}),
        }),
      );
      const rows = (result.Items ?? [])
        .filter((row) => typeof row.id === 'string')
        .map((row) => ({
          id: row.id as string,
          customAttributes: (row[CUSTOM_ATTRIBUTES_FIELD] ?? {}) as Record<string, unknown>,
        }));
      if (rows.length > 0) {
        matched += rows.length;
        await onPage(rows);
      }
      key = result.LastEvaluatedKey;
    } while (key);
    return matched;
  }

  /**
   * Moves one product's value from `from` to `to` in a single write. Refused
   * (answers false) when the product no longer has `from`, or already holds a
   * value under `to` — that value is kept rather than overwritten.
   */
  async renameProductValue(productId: string, from: string, to: string): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
          UpdateExpression: 'SET #ca.#to = #ca.#from REMOVE #ca.#from',
          ConditionExpression: 'attribute_exists(#ca.#from) AND attribute_not_exists(#ca.#to)',
          ExpressionAttributeNames: { '#ca': CUSTOM_ATTRIBUTES_FIELD, '#from': from, '#to': to },
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  /** Removes one product's value under `name`; false when it had none. */
  async removeProductValue(productId: string, name: string): Promise<boolean> {
    try {
      await this.dynamoDb.client.send(
        new UpdateCommand({
          TableName: INVENTORY_TABLE,
          Key: { PK: `PRODUCT#${productId}`, SK: 'METADATA' },
          UpdateExpression: 'REMOVE #ca.#name',
          ConditionExpression: 'attribute_exists(#ca.#name)',
          ExpressionAttributeNames: { '#ca': CUSTOM_ATTRIBUTES_FIELD, '#name': name },
        }),
      );
      return true;
    } catch (error: unknown) {
      if (isConditionFailure(error)) return false;
      throw error;
    }
  }

  private toEntity(row: Record<string, unknown>): ItemAttribute {
    const extras: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!KEY_ATTRIBUTES.has(key) && key !== 'attrType') extras[key] = value;
    }
    return {
      ...extras,
      id: row.id as string,
      name: row.name as string,
      type: (row.attrType as string | undefined) || 'text',
      visible: row.visible === true,
      resource: (row.resource as string | undefined) || 'items',
    };
  }
}
