import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ProductCategory } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

const PK_PREFIX = 'PRODUCT_CATEGORY#';

@Injectable()
export class ProductCategoriesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(category: ProductCategory): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: { PK: `${PK_PREFIX}${category.id}`, SK: 'METADATA', ...category },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<ProductCategory | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${PK_PREFIX}${id}`, SK: 'METADATA' },
      }),
    );
    return result.Item ? this.toCategory(result.Item) : null;
  }

  /** Full sweep — the category set is small and the settings table renders it whole. */
  async findAll(): Promise<ProductCategory[]> {
    const categories: ProductCategory[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: INVENTORY_TABLE,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
          ExpressionAttributeValues: { ':pk': PK_PREFIX, ':sk': 'METADATA' },
          ExclusiveStartKey: cursor,
        }),
      );
      categories.push(...(result.Items || []).map((i) => this.toCategory(i)));
      cursor = result.LastEvaluatedKey;
    } while (cursor);

    return categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Case-insensitive; scans the full set rather than Scan+Limit, which filters after the limit. */
  async findByName(name: string): Promise<ProductCategory | null> {
    const target = name.trim().toLowerCase();
    const all = await this.findAll();
    return all.find((c) => c.name.trim().toLowerCase() === target) ?? null;
  }

  async update(
    id: string,
    attrs: Partial<ProductCategory>,
  ): Promise<ProductCategory> {
    const setParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    const updates = { ...attrs, updatedAt: new Date().toISOString() };

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'createdAt' || value === undefined) continue;
      names[`#${key}`] = key;
      setParts.push(`#${key} = :${key}`);
      values[`:${key}`] = value;
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${PK_PREFIX}${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toCategory(result.Attributes!);
  }

  private toCategory(item: Record<string, unknown>): ProductCategory {
    return {
      id: item.id as string,
      name: item.name as string,
      description: item.description as string | undefined,
      photoKey: item.photoKey as string | undefined,
      parentId: item.parentId as string | undefined,
      status: item.status as ProductCategory['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
