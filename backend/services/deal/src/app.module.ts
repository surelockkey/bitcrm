import { Module } from '@nestjs/common';
import { DynamoDbModule, RedisModule, AuthModule, LoggerModule } from '@bitcrm/shared';
import { AppController } from './app.controller';

@Module({
  imports: [LoggerModule.forRoot({ serviceName: 'deal-service' }), DynamoDbModule, RedisModule, AuthModule],
  controllers: [AppController],
})
export class AppModule {}
