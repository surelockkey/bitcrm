import { Injectable, Logger } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type ExternalCompany } from '@bitcrm/types';
import { DEALS_TABLE, DEALS_GSI1_NAME } from '../common/constants/dynamo.constants';
import {
  EXTERNAL_COMPANY_PK_PREFIX,
  EXTERNAL_COMPANY_SK,
  EXTERNAL_COMPANY_GSI1PK,
} from './external-companies.constants';

/**
 * External-company catalog rows in the single BitCRM_Deals table:
 *   PK = EXTERNAL_COMPANY#<id>, SK = METADATA
 *   GSI1PK = CATALOG#EXTERNAL_COMPANY, GSI1SK = <name>  (list index)
 *
 * Reuses the existing GSI1 exactly as the other deal catalogs do — no new
 * index, no schema migration.
 */
/** Items evaluated per reference-check Scan page (the filter runs after this). */
const REFERENCE_SCAN_PAGE = 500;

@Injectable()
export class ExternalCompaniesRepository {
  private readonly logger = new Logger(ExternalCompaniesRepository.name);

  constructor(private readonly dynamoDb: DynamoDbService) {}

  private item(company: ExternalCompany): Record<string, unknown> {
    return {
      PK: `${EXTERNAL_COMPANY_PK_PREFIX}${company.id}`,
      SK: EXTERNAL_COMPANY_SK,
      GSI1PK: EXTERNAL_COMPANY_GSI1PK,
      GSI1SK: company.name.toLowerCase(),
      ...company,
    };
  }

  private toEntity(item: Record<string, unknown>): ExternalCompany {
    const { PK, SK, GSI1PK, GSI1SK, ...entity } = item;
    return entity as unknown as ExternalCompany;
  }

  /** Insert a new company; fails if the id already exists. */
  async create(company: ExternalCompany): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: DEALS_TABLE,
        Item: this.item(company),
        ConditionExpression: 'attribute_not_exists(PK)',
      }),
    );
    this.logger.log(`Created external company ${company.id} (${company.name})`);
  }

  /** Full replace of an existing company (used by the update path). */
  async put(company: ExternalCompany): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({ TableName: DEALS_TABLE, Item: this.item(company) }),
    );
  }

  async get(id: string): Promise<ExternalCompany | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${EXTERNAL_COMPANY_PK_PREFIX}${id}`, SK: EXTERNAL_COMPANY_SK },
      }),
    );
    return result.Item ? this.toEntity(result.Item) : null;
  }

  async listAll(): Promise<ExternalCompany[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: DEALS_TABLE,
        IndexName: DEALS_GSI1_NAME,
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': EXTERNAL_COMPANY_GSI1PK },
      }),
    );
    return (result.Items || []).map((i) => this.toEntity(i));
  }

  /**
   * Whether any deal still points at this company. Drives archive-vs-delete, so
   * a false negative would destroy a company that jobs reference.
   *
   * DynamoDB applies `Limit` to items EVALUATED, before the FilterExpression —
   * a filtered Scan routinely returns an empty page plus a cursor, so pages
   * must be followed until a match turns up or the table is exhausted. A
   * page size (rather than Limit: 1) keeps that to a few round trips.
   */
  async isReferencedByDeal(id: string): Promise<boolean> {
    let cursor: Record<string, unknown> | undefined;
    do {
      const result: any = await this.dynamoDb.client.send(
        new ScanCommand({
          TableName: DEALS_TABLE,
          FilterExpression: '#externalCompanyId = :id',
          ExpressionAttributeNames: { '#externalCompanyId': 'externalCompanyId' },
          ExpressionAttributeValues: { ':id': id },
          Limit: REFERENCE_SCAN_PAGE,
          ...(cursor ? { ExclusiveStartKey: cursor } : {}),
        }),
      );
      if ((result.Items?.length ?? 0) > 0) return true;
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return false;
  }

  async remove(id: string): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: DEALS_TABLE,
        Key: { PK: `${EXTERNAL_COMPANY_PK_PREFIX}${id}`, SK: EXTERNAL_COMPANY_SK },
      }),
    );
    this.logger.log(`Deleted external company ${id}`);
  }
}
