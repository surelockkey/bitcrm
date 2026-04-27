import { Module } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  AuthModule as SharedAuthModule,
  CognitoAdminModule,
  CognitoAuthModule,
  EventsModule,
  LoggerModule,
  MetricsModule,
  HealthModule,
  ConnectivityModule,
} from '@bitcrm/shared';
import { AppController } from './app.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'user-service' }),
    MetricsModule.forRoot({ serviceName: 'user-service' }),
    HealthModule,
    ConnectivityModule.forRoot({
      serviceName: 'user-service',
      failFast: ['dynamodb', 'redis'],
      dynamodb: { tables: ['BitCRM_Users'] },
      redis: true,
      sns: { topics: ['bitcrm-user-events'] },
    }),
    DynamoDbModule,
    RedisModule,
    SharedAuthModule,
    CognitoAdminModule,
    CognitoAuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'user-service',
        topicArns: {
          'bitcrm-user-events': `arn:aws:sns:${process.env.AWS_REGION || 'us-east-1'}:000000000000:bitcrm-user-events`,
        },
      },
    }),
    RolesModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
