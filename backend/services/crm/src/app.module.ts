import { Module } from '@nestjs/common';
import { DynamoDbModule, RedisModule, AuthModule, EventsModule, LoggerModule, MetricsModule, HealthModule, ConnectivityModule } from '@bitcrm/shared';
import { AppController } from './app.controller';
import { ContactsModule } from './contacts/contacts.module';
import { CompaniesModule } from './companies/companies.module';

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'crm-service' }),
    MetricsModule.forRoot({ serviceName: 'crm-service' }),
    HealthModule,
    ConnectivityModule.forRoot({
      serviceName: 'crm-service',
      failFast: ['dynamodb', 'redis'],
      dynamodb: { tables: ['BitCRM_Contacts', 'BitCRM_Companies'] },
      redis: true,
      sns: { topics: ['bitcrm-crm-events'] },
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'crm-service',
        topicArns: {
          crm: `arn:aws:sns:${process.env.AWS_REGION || 'us-east-1'}:000000000000:bitcrm-crm-events`,
        },
      },
    }),
    ContactsModule,
    CompaniesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
