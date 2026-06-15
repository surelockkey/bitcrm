import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDbService } from '../dynamodb/dynamodb.service';
import { HEALTH_DYNAMO_TABLES } from './health.constants';

@Injectable()
export class DynamoDbHealthIndicator extends HealthIndicator {
  constructor(
    private readonly dynamoDb: DynamoDbService,
    @Inject(HEALTH_DYNAMO_TABLES) private readonly tables: string[],
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // DescribeTable on the service's own tables — avoids account-wide
      // dynamodb:ListTables, which the least-privilege task roles don't allow.
      await Promise.all(
        this.tables.map((table) =>
          this.dynamoDb.client.send(new DescribeTableCommand({ TableName: table })),
        ),
      );
      return this.getStatus(key, true);
    } catch (error) {
      throw new HealthCheckError(
        'DynamoDB check failed',
        this.getStatus(key, false, {
          message: (error as Error).message,
        }),
      );
    }
  }
}
