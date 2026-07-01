import { Injectable } from '@nestjs/common';
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { type TechnicianDocument, type DocumentType } from '@bitcrm/types';
import { TECHNICIANS_TABLE, DOC_SK_PREFIX } from '../constants/dynamo.constants';

@Injectable()
export class DocumentsRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  async upsert(doc: TechnicianDocument): Promise<void> {
    await this.dynamoDb.client.send(
      new PutCommand({
        TableName: TECHNICIANS_TABLE,
        Item: {
          PK: `USER#${doc.userId}`,
          SK: `${DOC_SK_PREFIX}${doc.docType}`,
          ...doc,
        },
      }),
    );
  }

  async getByType(
    userId: string,
    docType: DocumentType,
  ): Promise<TechnicianDocument | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `${DOC_SK_PREFIX}${docType}` },
      }),
    );
    return result.Item ? (this.toDoc(result.Item) as TechnicianDocument) : null;
  }

  async listByUser(userId: string): Promise<TechnicianDocument[]> {
    const result = await this.dynamoDb.client.send(
      new QueryCommand({
        TableName: TECHNICIANS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `USER#${userId}`,
          ':sk': DOC_SK_PREFIX,
        },
      }),
    );
    return (result.Items || []).map(this.toDoc);
  }

  async delete(userId: string, docType: DocumentType): Promise<void> {
    await this.dynamoDb.client.send(
      new DeleteCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: `${DOC_SK_PREFIX}${docType}` },
      }),
    );
  }

  private toDoc(item: Record<string, unknown>): TechnicianDocument {
    return {
      userId: item.userId as string,
      docType: item.docType as DocumentType,
      s3Key: item.s3Key as string,
      contentType: item.contentType as string,
      uploadedBy: item.uploadedBy as string,
      uploadedAt: item.uploadedAt as string,
    };
  }
}
