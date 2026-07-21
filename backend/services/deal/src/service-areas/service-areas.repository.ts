import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ServiceArea } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  SERVICE_AREA_PK_PREFIX,
  SERVICE_AREA_SK,
  SERVICE_AREA_GSI1PK,
} from './service-areas.constants';

/**
 * Service-area catalog rows in the single BitCRM_Deals table:
 *   PK = SERVICE_AREA#<id>, SK = METADATA
 *   GSI1PK = CATALOG#SERVICE_AREA, GSI1SK = <priority>#<name>  (list index)
 */
@Injectable()
export class ServiceAreasRepository {
  private readonly logger = new Logger(ServiceAreasRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(area: ServiceArea): Record<string, unknown> {
    return {
      PK: `${SERVICE_AREA_PK_PREFIX}${area.id}`,
      SK: SERVICE_AREA_SK,
      GSI1PK: SERVICE_AREA_GSI1PK,
      GSI1SK: `${String(area.priority).padStart(6, '0')}#${area.name.toLowerCase()}`,
      ...area,
    };
  }

  /** Insert a new area; fails if the id already exists. */
  async create(area: ServiceArea): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(area),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created service area ${area.id} (${area.name})`);
  }

  /** Full replace of an existing area (used by the update path). */
  async put(area: ServiceArea): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(area) }),
    );
  }

  async get(id: string): Promise<ServiceArea | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${SERVICE_AREA_PK_PREFIX}${id}`, SK: SERVICE_AREA_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<ServiceArea[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': SERVICE_AREA_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${SERVICE_AREA_PK_PREFIX}${id}`, SK: SERVICE_AREA_SK },
      }),
    );
    this.logger.log(`Deleted service area ${id}`);
  }

  private toEntity(item: Record<string, unknown>): ServiceArea {
    return {
      id: item.id as string,
      name: item.name as string,
      priority: (item.priority as number) ?? 0,
      active: Boolean(item.active),
      type: item.type as ServiceArea['type'],
      definition: item.definition as ServiceArea['definition'],
      coverage: (item.coverage as ServiceArea['coverage']) || [],
      createdBy: item.createdBy as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    };
  }
}
