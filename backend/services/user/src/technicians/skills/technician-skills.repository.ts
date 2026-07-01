import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianSkill, type SkillStatus } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  GSI4_NAME,
  SKILL_SK_PREFIX,
  skillStatusGsiPk,
} from '../constants/dynamo.constants';

interface PaginatedSkills {
  items: TechnicianSkill[];
  nextCursor?: string;
}

@Injectable()
export class TechnicianSkillsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async create(skill: TechnicianSkill): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: `USER#${skill.userId}`,
          SK: `${SKILL_SK_PREFIX}${skill.skillId}`,
          GSI4PK: skillStatusGsiPk(skill.status),
          GSI4SK: `${skill.userId}#${skill.skillId}`,
          ...skill,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR attribute_not_exists(SK)',
      }),
    );
  }

  async getById(userId: string, skillId: string): Promise<TechnicianSkill | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `${SKILL_SK_PREFIX}${skillId}` },
      }),
    );
    return result.Item ? this.toSkill(result.Item) : null;
  }

  async listByUser(userId: string): Promise<TechnicianSkill[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': SKILL_SK_PREFIX,
        },
      }),
    );
    return (result.Items || []).map(this.toSkill);
  }

  async listPendingAcrossTechs(
    limit: number,
    cursor?: string,
  ): Promise<PaginatedSkills> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: { ':pk': skillStatusGsiPk('pending') },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );
    return {
      items: (result.Items || []).map(this.toSkill),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /** All approved skills across every technician (paginates internally). */
  async listAllApproved(): Promise<TechnicianSkill[]> {
    const items: TechnicianSkill[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          IndexName: GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          ExpressionAttributeValues: { ':pk': skillStatusGsiPk('approved') },
          ExclusiveStartKey: lastKey,
        }),
      );
      items.push(...(result.Items || []).map(this.toSkill));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  }

  async updateStatus(
    userId: string,
    skillId: string,
    attrs: Partial<TechnicianSkill>,
  ): Promise<TechnicianSkill> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const updates: Record<string, unknown> = { ...attrs };
    if (attrs.status) {
      updates.GSI4PK = skillStatusGsiPk(attrs.status);
    }

    const immutable = new Set(['skillId', 'userId', 'proposedBy', 'proposedAt']);
    for (const [key, value] of Object.entries(updates)) {
      if (immutable.has(key)) continue;
      const n = `#${key}`;
      names[n] = key;
      if (value === undefined) {
        if (key in attrs) removeParts.push(n);
      } else {
        setParts.push(`${n} = :${key}`);
        values[`:${key}`] = value;
      }
    }

    const segments: string[] = [];
    if (setParts.length) segments.push(`SET ${setParts.join(', ')}`);
    if (removeParts.length) segments.push(`REMOVE ${removeParts.join(', ')}`);

    const result = await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `${SKILL_SK_PREFIX}${skillId}` },
        UpdateExpression: segments.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues:
          Object.keys(values).length > 0 ? values : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toSkill(result.Attributes!);
  }

  async delete(userId: string, skillId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `${SKILL_SK_PREFIX}${skillId}` },
      }),
    );
  }

  private toSkill(item: Record<string, unknown>): TechnicianSkill {
    return {
      skillId: item.skillId as string,
      userId: item.userId as string,
      type: item.type as TechnicianSkill['type'],
      value: item.value as string,
      status: item.status as SkillStatus,
      proposedBy: item.proposedBy as string,
      proposedAt: item.proposedAt as string,
      reviewedBy: item.reviewedBy as string | undefined,
      reviewedAt: item.reviewedAt as string | undefined,
      comments: item.comments as string | undefined,
    };
  }

  private encodeCursor(key?: Record<string, unknown>): string | undefined {
    if (!key) return undefined;
    return Buffer.from(JSON.stringify(key)).toString('base64url');
  }

  private decodeCursor(cursor?: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'));
  }
}
