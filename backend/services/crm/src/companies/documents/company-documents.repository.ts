import { Injectable } from '@nestjs/common';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type CompanyDocument, type CompanyDocumentType } from '@bitcrm/types';
import { COMPANIES_TABLE, COMPANY_DOC_SK_PREFIX } from '../../common/constants/dynamo.constants';

@Injectable()
export class CompanyDocumentsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  private key(companyId: string, docType: string) {
    return { PK: `COMPANY#${companyId}`, SK: `${COMPANY_DOC_SK_PREFIX}${docType}` };
  }

  async upsert(doc: CompanyDocument): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: COMPANIES_TABLE,
        Item: { ...this.key(doc.companyId, doc.docType), ...doc },
      }),
    );
  }

  async getByType(companyId: string, docType: CompanyDocumentType): Promise<CompanyDocument | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({ TableName: COMPANIES_TABLE, Key: this.key(companyId, docType) }),
    );
    return result.Item ? this.toDoc(result.Item) : null;
  }

  async listByCompany(companyId: string): Promise<CompanyDocument[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: COMPANIES_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': `COMPANY#${companyId}`, ':sk': COMPANY_DOC_SK_PREFIX },
      }),
    );
    return (result.Items || []).map((i) => this.toDoc(i));
  }

  async delete(companyId: string, docType: CompanyDocumentType): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({ TableName: COMPANIES_TABLE, Key: this.key(companyId, docType) }),
    );
  }

  private toDoc(item: Record<string, unknown>): CompanyDocument {
    return {
      companyId: item.companyId as string,
      docType: item.docType as CompanyDocumentType,
      s3Key: item.s3Key as string,
      contentType: item.contentType as string,
      uploadedBy: item.uploadedBy as string,
      uploadedAt: item.uploadedAt as string,
    };
  }
}
