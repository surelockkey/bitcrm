import { Controller, Get, HttpStatus, Optional, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { Public } from '../auth/public.decorator';
import { DynamoDbHealthIndicator } from './dynamodb.health-indicator';
import { RedisHealthIndicator } from './redis.health-indicator';
import { ConnectivityCheckService } from '../connectivity/connectivity-check.service';

@ApiTags('Health')
@Controller()
export class SharedHealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly dynamoDbIndicator: DynamoDbHealthIndicator,
    private readonly redisIndicator: RedisHealthIndicator,
    @Optional() private readonly connectivity?: ConnectivityCheckService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.dynamoDbIndicator.isHealthy('dynamodb'),
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }

  @Public()
  @Get('health/live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('health/ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.dynamoDbIndicator.isHealthy('dynamodb'),
      () => this.redisIndicator.isHealthy('redis'),
    ]);
  }

  @Public()
  @Get('health/dependencies')
  @ApiOperation({
    summary: 'Connectivity status of external dependencies',
    description:
      'Returns the most recent probe results for DynamoDB, Redis, S3, SNS, SQS, and HTTP services. ' +
      'Updated periodically by the connectivity check service. Returns 503 if any dependency is down.',
  })
  dependencies(@Res({ passthrough: true }) res: Response) {
    if (!this.connectivity) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    const { results, lastRunAt } = this.connectivity.getSnapshot();
    const healthy = results.length > 0 && results.every((r) => r.ok);
    if (!healthy && results.length > 0) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      healthy,
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : null,
      results,
    };
  }
}
