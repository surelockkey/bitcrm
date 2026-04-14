import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { Public, DynamoDbService, RedisService } from '@bitcrm/shared';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(
    private readonly dynamoDb: DynamoDbService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  health() {
    return { status: 'ok', service: 'crm-service', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('ping')
  @ApiOperation({ summary: 'Check DynamoDB and Redis connectivity' })
  async ping() {
    let dynamodb = 'error';
    let redis = 'error';

    try {
      await this.dynamoDb.client.send(new ListTablesCommand({}));
      dynamodb = 'connected';
    } catch {}

    try {
      await this.redis.client.ping();
      redis = 'connected';
    } catch {}

    return { dynamodb, redis };
  }
}
