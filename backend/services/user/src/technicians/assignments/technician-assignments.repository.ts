import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type AssignmentStatus } from '@bitcrm/types';
import {
  TECHNICIANS_TABLE,
  GSI4_NAME,
  JOB_TYPE_SK_PREFIX,
  SERVICE_AREA_SK_PREFIX,
  jobTypeStatusGsiPk,
  serviceAreaStatusGsiPk,
} from '../constants/dynamo.constants';

/** Which catalog an assignment points at. */
export type AssignmentKind = 'job_type' | 'service_area';

/**
 * Storage shape shared by both kinds. The service maps this to the public
 * `TechnicianJobType` / `TechnicianServiceArea` entities at its boundary, so the
 * duplicated key-handling lives here once rather than in two near-identical
 * repositories.
 */
export interface TechnicianAssignment {
  userId: string;
  kind: AssignmentKind;
  /** Job-type id or service-area id, depending on `kind`. */
  catalogId: string;
  status: AssignmentStatus;
  proposedBy: string;
  proposedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comments?: string;
}

interface PaginatedAssignments {
  items: TechnicianAssignment[];
  nextCursor?: string;
}

const skPrefix = (kind: AssignmentKind) =>
  kind === 'job_type' ? JOB_TYPE_SK_PREFIX : SERVICE_AREA_SK_PREFIX;

const statusGsiPk = (kind: AssignmentKind, status: string) =>
  kind === 'job_type' ? jobTypeStatusGsiPk(status) : serviceAreaStatusGsiPk(status);

@Injectable()
export class TechnicianAssignmentsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(userId: string, kind: AssignmentKind, catalogId: string) {
    return { PK: `USER#${userId}`, SK: `${skPrefix(kind)}${catalogId}` };
  }

  /** Insert; fails if this technician already holds the catalog entry. */
  async create(a: TechnicianAssignment): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          ...this.key(a.userId, a.kind, a.catalogId),
          GSI4PK: statusGsiPk(a.kind, a.status),
          GSI4SK: `${a.userId}#${a.catalogId}`,
          ...a,
        },
        ConditionExpression: 'attribute_not_exists(PK) OR attribute_not_exists(SK)',
      }),
    );
  }

  async getById(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
  ): Promise<TechnicianAssignment | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: this.key(userId, kind, catalogId),
      }),
    );
    return result.Item ? this.toAssignment(result.Item) : null;
  }

  /** One technician's assignments; omit `kind` for both. */
  async listByUser(userId: string, kind?: AssignmentKind): Promise<TechnicianAssignment[]> {
    if (kind) return this.queryByUser(userId, skPrefix(kind));
    const [jobTypes, areas] = await Promise.all([
      this.queryByUser(userId, JOB_TYPE_SK_PREFIX),
      this.queryByUser(userId, SERVICE_AREA_SK_PREFIX),
    ]);
    return [...jobTypes, ...areas];
  }

  private async queryByUser(userId: string, prefix: string): Promise<TechnicianAssignment[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':sk': prefix },
      }),
    );
    return (result.Items || []).map(this.toAssignment);
  }

  async listPendingAcrossTechs(
    kind: AssignmentKind,
    limit: number,
    cursor?: string,
  ): Promise<PaginatedAssignments> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        IndexName: GSI4_NAME,
        KeyConditionExpression: 'GSI4PK = :pk',
        ExpressionAttributeValues: { ':pk': statusGsiPk(kind, 'pending') },
        Limit: limit,
        ExclusiveStartKey: this.decodeCursor(cursor),
      }),
    );
    return {
      items: (result.Items || []).map(this.toAssignment),
      nextCursor: this.encodeCursor(result.LastEvaluatedKey),
    };
  }

  /** Every approved assignment of one kind, across all technicians. */
  async listAllApproved(kind: AssignmentKind): Promise<TechnicianAssignment[]> {
    const items: TechnicianAssignment[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.dynamoDb.client.send(
        new QueryCommand({
          TableName: TECHNICIANS_TABLE,
          IndexName: GSI4_NAME,
          KeyConditionExpression: 'GSI4PK = :pk',
          ExpressionAttributeValues: { ':pk': statusGsiPk(kind, 'approved') },
          ExclusiveStartKey: lastKey,
        }),
      );
      items.push(...(result.Items || []).map(this.toAssignment));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return items;
  }

  async updateStatus(
    userId: string,
    kind: AssignmentKind,
    catalogId: string,
    attrs: Partial<TechnicianAssignment>,
  ): Promise<TechnicianAssignment> {
    const setParts: string[] = [];
    const removeParts: string[] = [];
    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};

    const updates: Record<string, unknown> = { ...attrs };
    if (attrs.status) {
      updates.GSI4PK = statusGsiPk(kind, attrs.status);
    }

    const immutable = new Set(['userId', 'kind', 'catalogId', 'proposedBy', 'proposedAt']);
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
        Key: this.key(userId, kind, catalogId),
        UpdateExpression: segments.join(' '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues:
          Object.keys(values).length > 0 ? values : undefined,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return this.toAssignment(result.Attributes!);
  }

  async delete(userId: string, kind: AssignmentKind, catalogId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: TECHNICIANS_TABLE,
        Key: this.key(userId, kind, catalogId),
      }),
    );
  }

  private toAssignment(item: Record<string, unknown>): TechnicianAssignment {
    return {
      userId: item.userId as string,
      kind: item.kind as AssignmentKind,
      catalogId: item.catalogId as string,
      status: item.status as AssignmentStatus,
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
