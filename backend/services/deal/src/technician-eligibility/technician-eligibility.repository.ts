import { Injectable } from '@nestjs/common';
import {
  BatchGetCommand,
  GetCommand,
  PutCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { DEALS_TABLE } from '../common/constants/dynamo.constants';
import { type TechnicianEligibility } from './technician-eligibility.types';

const PK_PREFIX = 'TECH_ELIGIBILITY#';
const SK = 'ELIGIBILITY';

/** DynamoDB's hard ceiling on one BatchGetItem. */
const BATCH_GET_CHUNK = 100;
/** A page of jobs is at most 100 rows, so it can never name more than this. */
const MAX_BATCH_IDS = 100;

@Injectable()
export class TechnicianEligibilityRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async upsert(e: TechnicianEligibility): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: { PK: `${PK_PREFIX}${e.technicianId}`, SK, ...e },
      }),
    );
  }

  async get(technicianId: string): Promise<TechnicianEligibility | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${PK_PREFIX}${technicianId}`, SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  /**
   * The projected rows for a set of technician ids — one BatchGet per 100
   * instead of one Get per id, which is what the jobs-list side-load needs to
   * name the technicians of a page without a call into user-service.
   *
   * Ids are deduped and capped (a page names at most `MAX_BATCH_IDS` people);
   * an id with no row is simply absent from the answer, exactly as `get`
   * returns null for one.
   */
  async getMany(technicianIds: string[]): Promise<TechnicianEligibility[]> {
    const unique = [...new Set(technicianIds.filter(Boolean))].slice(0, MAX_BATCH_IDS);
    if (!unique.length) return [];

    const rows: TechnicianEligibility[] = [];
    for (let i = 0; i < unique.length; i += BATCH_GET_CHUNK) {
      const chunk = unique.slice(i, i + BATCH_GET_CHUNK);
      const result = await this.dynamoDb.client.send(
        new BatchGetCommand({
          RequestItems: {
            [DEALS_TABLE]: {
              Keys: chunk.map((id) => ({ PK: `${PK_PREFIX}${id}`, SK })),
            },
          },
        }),
      );
      rows.push(...(result.Responses?.[DEALS_TABLE] || []).map(this.toEntity));
    }
    return rows;
  }

  async remove(technicianId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${PK_PREFIX}${technicianId}`, SK },
      }),
    );
  }

  /**
   * Every projected technician, paged to exhaustion.
   *
   * A Scan spends its 1MB budget on what the table holds before the filter
   * runs, and this table is overwhelmingly deals — so one page can come back
   * with a handful of eligibility rows, or none, however many are stored. Both
   * readers take what this returns as the whole truth: the assignment dialog
   * offers exactly these people, so a technician left out is simply missing
   * from the picker; and the boot reconcile removes the rows user-service no
   * longer vouches for, so a row it cannot see is a row it can never remove.
   */
  async listAll(): Promise<TechnicianEligibility[]> {
    const rows: TechnicianEligibility[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const result = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: DEALS_TABLE,
          FilterExpression: 'begins_with(PK, :pk)',
          ExpressionAttributeValues: { ':pk': PK_PREFIX },
          ExclusiveStartKey: lastKey,
        }),
      );
      rows.push(...(result.Items || []).map(this.toEntity));
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return rows;
  }

  private toEntity(item: Record<string, unknown>): TechnicianEligibility {
    return {
      technicianId: item.technicianId as string,
      jobTypeIds: (item.jobTypeIds as string[]) || [],
      serviceAreaIds: (item.serviceAreaIds as string[]) || [],
      assignable: Boolean(item.assignable),
      firstName: item.firstName as string | undefined,
      lastName: item.lastName as string | undefined,
      department: item.department as string | undefined,
      homeAddress: item.homeAddress as TechnicianEligibility['homeAddress'],
      updatedAt: item.updatedAt as string,
    };
  }
}
