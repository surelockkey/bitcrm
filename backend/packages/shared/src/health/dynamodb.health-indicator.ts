import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDbService } from '../dynamodb/dynamodb.service';

@Injectable()
export class DynamoDbHealthIndicator extends HealthIndicator {
  constructor(private readonly dynamoDb: DynamoDbService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.dynamoDb.client.send(new ListTablesCommand({}));
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
