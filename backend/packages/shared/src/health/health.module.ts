import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { SharedHealthController } from './health.controller';
import { DynamoDbHealthIndicator } from './dynamodb.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';

@Module({
  imports: [TerminusModule],
  controllers: [SharedHealthController],
  providers: [DynamoDbHealthIndicator, RedisHealthIndicator],
  exports: [DynamoDbHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
