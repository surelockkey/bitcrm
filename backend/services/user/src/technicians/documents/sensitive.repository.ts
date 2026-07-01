import { Injectable } from '@nestjs/common';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { TECHNICIANS_TABLE, SENSITIVE_SK } from '../constants/dynamo.constants';

export interface SensitiveCiphertext {
  ssnEncrypted?: string;
  bankAccountEncrypted?: string;
}

@Injectable()
export class SensitiveRepository {
  constructor(private readonly dynamoDb: DynamoDbService) {}

  /** Merge-write only the provided encrypted fields. */
  async upsert(userId: string, fields: SensitiveCiphertext): Promise<void> {
    const setParts: string[] = ['#updatedAt = :updatedAt'];
    const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
    const values: Record<string, unknown> = {
      ':updatedAt': new Date().toISOString(),
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      setParts.push(`#${key} = :${key}`);
    }

    await this.dynamoDb.client.send(
      new UpdateCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: SENSITIVE_SK },
        UpdateExpression: `SET ${setParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  async get(userId: string): Promise<SensitiveCiphertext | null> {
    const result = await this.dynamoDb.client.send(
      new GetCommand({
        TableName: TECHNICIANS_TABLE,
        Key: { PK: `USER#${userId}`, SK: SENSITIVE_SK },
      }),
    );
    if (!result.Item) return null;
    return {
      ssnEncrypted: result.Item.ssnEncrypted as string | undefined,
      bankAccountEncrypted: result.Item.bankAccountEncrypted as string | undefined,
    };
  }
}
