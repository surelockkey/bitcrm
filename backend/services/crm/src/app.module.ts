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
      failFast: [],
      dynamodb: {
        tables: [
          process.env.CONTACTS_TABLE || 'BitCRM_Contacts',
          process.env.COMPANIES_TABLE || 'BitCRM_Companies',
        ],
      },
      redis: true,
      sns: process.env.CRM_EVENTS_TOPIC_ARN ? { topics: [process.env.CRM_EVENTS_TOPIC_ARN] } : undefined,
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'crm-service',
        topicArns: process.env.CRM_EVENTS_TOPIC_ARN
          ? { crm: process.env.CRM_EVENTS_TOPIC_ARN }
          : {},
      },
    }),
    ContactsModule,
    CompaniesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
