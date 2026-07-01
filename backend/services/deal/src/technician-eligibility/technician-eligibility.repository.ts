import { Injectable } from '@nestjs/common';
import {
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

  async remove(technicianId: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${PK_PREFIX}${technicianId}`, SK },
      }),
    );
  }

  async listAll(): Promise<TechnicianEligibility[]> {
    const result = await this.dynamoDb.client.send(
      new ScanCommand({
        TableName: DEALS_TABLE,
        FilterExpression: 'begins_with(PK, :pk)',
        ExpressionAttributeValues: { ':pk': PK_PREFIX },
      }),
    );
    return (result.Items || []).map(this.toEntity);
  }

  private toEntity(item: Record<string, unknown>): TechnicianEligibility {
    return {
      technicianId: item.technicianId as string,
      approvedSkills: (item.approvedSkills as string[]) || [],
      serviceAreas: (item.serviceAreas as string[]) || [],
      assignable: Boolean(item.assignable),
      updatedAt: item.updatedAt as string,
    };
  }
}
