import { DynamicModule, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { SharedHealthController } from './health.controller';
import { DynamoDbHealthIndicator } from './dynamodb.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import { HEALTH_DYNAMO_TABLES } from './health.constants';

export interface HealthModuleOptions {
  /** DynamoDB tables to DescribeTable in the dynamodb health indicator. */
  dynamoTables?: string[];
}

@Module({})
export class HealthModule {
  static forRoot(options: HealthModuleOptions = {}): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule],
      controllers: [SharedHealthController],
      providers: [
        { provide: HEALTH_DYNAMO_TABLES, useValue: options.dynamoTables ?? [] },
        DynamoDbHealthIndicator,
        RedisHealthIndicator,
      ],
      exports: [DynamoDbHealthIndicator, RedisHealthIndicator],
    };
  }
}
