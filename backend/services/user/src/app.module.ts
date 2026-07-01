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
  StorageModule,
} from '@bitcrm/shared';
import { AppController } from './app.controller';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { TechniciansModule } from './technicians/technicians.module';

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'user-service' }),
    MetricsModule.forRoot({ serviceName: 'user-service' }),
    HealthModule.forRoot({
      dynamoTables: [process.env.USERS_TABLE || 'BitCRM_Users'],
    }),
    ConnectivityModule.forRoot({
      serviceName: 'user-service',
      failFast: [],
      dynamodb: { tables: [process.env.USERS_TABLE || 'BitCRM_Users'] },
      redis: true,
      sns: process.env.USER_EVENTS_TOPIC_ARN ? { topics: [process.env.USER_EVENTS_TOPIC_ARN] } : undefined,
    }),
    DynamoDbModule,
    RedisModule,
    StorageModule,
    SharedAuthModule,
    CognitoAdminModule,
    CognitoAuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'user-service',
        topicArns: process.env.USER_EVENTS_TOPIC_ARN
          ? { 'user-events': process.env.USER_EVENTS_TOPIC_ARN }
          : {},
      },
    }),
    // TechniciansModule must be scanned before RolesModule: RolesModule
    // forwardRef-imports UsersModule, which would otherwise register the
    // `/api/users/:id` route ahead of the bare `/api/users/technicians` list
    // route and shadow it.
    TechniciansModule,
    RolesModule,
    UsersModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
