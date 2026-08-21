import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ContainerTemplate } from '@bitcrm/types';
import { INVENTORY_TABLE } from '../common/constants/dynamo.constants';

/** Page size when sweeping the table for a name match — see findByName. */
const NAME_SCAN_PAGE = 500;

@Injectable()
export class ContainerTemplatesRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(template: ContainerTemplate): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: INVENTORY_TABLE,
        Item: {
          PK: `CONTAINER_TEMPLATE#${template.id}`,
          SK: 'METADATA',
          ...template,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
  }

  async findById(id: string): Promise<ContainerTemplate | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER_TEMPLATE#${id}`, SK: 'METADATA' },
      }),
    );

    if (!result.Item) return null;
    return this.toTemplate(result.Item);
  }

  /**
   * Case-insensitive name lookup used for uniqueness.
   *
   * Pages until a match or exhaustion rather than `Scan({FilterExpression, Limit: 1})`:
   * DynamoDB applies `Limit` to items *evaluated*, before the filter runs, so the
   * one-shot form routinely returns an empty page and a `LastEvaluatedKey` — which
   * would read as "name is free" and let a duplicate through.
   */
  async findByName(name: string): Promise<ContainerTemplate | null> {
    const target = name.trim().toLowerCase();
    let cursor: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: INVENTORY_TABLE,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
          ExpressionAttributeValues: {
            ':pk': 'CONTAINER_TEMPLATE#',
            ':sk': 'METADATA',
          },
          Limit: NAME_SCAN_PAGE,
          ExclusiveStartKey: cursor,
        }),
      );

      const match = (result.Items || []).find(
        (item) => String(item.name ?? '').trim().toLowerCase() === target,
      );
      if (match) return this.toTemplate(match);

      cursor = result.LastEvaluatedKey;
    } while (cursor);

    return null;
  }

  async findAll(): Promise<ContainerTemplate[]> {
    const templates: ContainerTemplate[] = [];
    let cursor: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: INVENTORY_TABLE,
          FilterExpression: 'begins_with(PK, :pk) AND SK = :sk',
          ExpressionAttributeValues: {
            ':pk': 'CONTAINER_TEMPLATE#',
            ':sk': 'METADATA',
          },
          ExclusiveStartKey: cursor,
        }),
      );

      templates.push(...(result.Items || []).map((i) => this.toTemplate(i)));
      cursor = result.LastEvaluatedKey;
    } while (cursor);

    return templates.sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(
    id: string,
    attrs: Partial<ContainerTemplate>,
  ): Promise<ContainerTemplate> {
    const setParts: string[] = [];
    const expressionNames: Record<string, string> = {};
    const expressionValues: Record<string, unknown> = {};

    const updates = { ...attrs, updatedAt: new Date().toISOString() };
    const immutableKeys = new Set(['id', 'createdAt']);

    for (const [key, value] of Object.entries(updates)) {
      if (immutableKeys.has(key) || value === undefined) continue;
      expressionNames[`#${key}`] = key;
      setParts.push(`#${key} = :${key}`);
      expressionValues[`:${key}`] = value;
    }

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER_TEMPLATE#${id}`, SK: 'METADATA' },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: expressionNames,
        ExpressionAttributeValues: expressionValues,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );

    return this.toTemplate(result.Attributes!);
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: INVENTORY_TABLE,
        Key: { PK: `CONTAINER_TEMPLATE#${id}`, SK: 'METADATA' },
      }),
    );
  }

  private toTemplate(item: Record<string, unknown>): ContainerTemplate {
    return {
      id: item.id as string,
      name: item.name as string,
      description: item.description as string | undefined,
      items: (item.items as ContainerTemplate['items']) ?? [],
      status: item.status as ContainerTemplate['status'],
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
