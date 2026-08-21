import { Injectable } from '@nestjs/common';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type Brand } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

const PK_PREFIX = 'BRAND#';

@Injectable()
export class BrandsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(brand: Brand): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: { PK: `${PK_PREFIX}${brand.id}`, SK: 'METADATA', ...brand },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<Brand | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `${PK_PREFIX}${id}`, SK: 'METADATA' },
      }),
    );
    return result.Item ? this.toBrand(result.Item) : null;
  }

  /** Full sweep — the brand set is small and the settings table renders it whole. */
  async findAll(): Promise<Brand[]> {
    const brands: Brand[] = [];
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
      brands.push(...(result.Items || []).map((i) => this.toBrand(i)));
      cursor = result.LastEvaluatedKey;
    } while (cursor);

    return brands.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Case-insensitive; scans the full set rather than Scan+Limit, which filters after the limit. */
  async findByName(name: string): Promise<Brand | null> {
    const target = name.trim().toLowerCase();
    const all = await this.findAll();
    return all.find((c) => c.name.trim().toLowerCase() === target) ?? null;
  }

  async update(
    id: string,
    attrs: Partial<Brand>,
  ): Promise<Brand> {
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

    return this.toBrand(result.Attributes!);
  }

  private toBrand(item: Record<string, unknown>): Brand {
    return {
      id: item.id as string,
      name: item.name as string,
      description: item.description as string | undefined,
      photoKey: item.photoKey as string | undefined,
      status: item.status as Brand['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
