import { Module, OnModuleInit, Optional } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  AuthModule,
  EventsModule,
  LoggerModule,
  MetricsModule,
  HealthModule,
  ConnectivityModule, StorageModule,
  SqsConsumerService } from '@bitcrm/shared';
import { AppController } from './app.controller';
import { TelephonyModule } from './telephony/telephony.module';
import { PresenceModule } from './presence/presence.module';
import { CallsModule } from './calls/calls.module';
import { VoiceModule } from './voice/voice.module';
import { ExtsModule } from './exts/exts.module';
import { NumbersModule } from './numbers/numbers.module';
import { CallDevicesModule } from './call-devices/call-devices.module';
import { CallGroupsModule } from './call-groups/call-groups.module';
import { CallFlowsModule } from './call-flows/call-flows.module';
import { CallTagsModule } from './call-tags/call-tags.module';
import { BlockedCallersModule } from './blocked-callers/blocked-callers.module';
import { CallTrackingModule } from './calls/tracking/call-tracking.module';
import { DbSetupService } from './common/db-setup.service';
import { CALLS_TABLE } from './common/constants/dynamo.constants';
import { CALL_GROUPS_TABLE } from './call-groups/call-groups.constants';
import { CALL_FLOWS_TABLE } from './call-flows/call-flows.constants';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_ENDPOINT = process.env.AWS_ENDPOINT;
/**
 * deal-events → `dealTotal` on linked calls (CallDealEventsHandler). Unset,
 * nothing is consumed and the reports fall back to asking deal-service for
 * the rows that carry no total.
 */
const DEAL_EVENTS_QUEUE_URL = process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL;

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'telephony-service' }),
    // Imported calls keep their audio in our bucket: Workiz will not be
    // there to serve it, and Twilio never had it.
    StorageModule,
    MetricsModule.forRoot({ serviceName: 'telephony-service' }),
    HealthModule.forRoot({
      dynamoTables: [CALLS_TABLE, CALL_GROUPS_TABLE, CALL_FLOWS_TABLE],
    }),
    ConnectivityModule.forRoot({
      serviceName: 'telephony-service',
      failFast: [],
      dynamodb: {
        tables: [CALLS_TABLE, CALL_GROUPS_TABLE, CALL_FLOWS_TABLE],
      },
      redis: true,
      sns: process.env.CALL_EVENTS_TOPIC_ARN
        ? { topics: [process.env.CALL_EVENTS_TOPIC_ARN] }
        : undefined,
      sqs: DEAL_EVENTS_QUEUE_URL ? { queues: [DEAL_EVENTS_QUEUE_URL] } : undefined,
      httpServices: [
        { name: 'user', url: (process.env.USER_SERVICE_URL ?? 'http://localhost:4001') + '/api/users/health' },
        { name: 'crm', url: (process.env.CRM_SERVICE_URL ?? 'http://localhost:4002') + '/api/crm/health' },
        { name: 'deal', url: (process.env.DEAL_SERVICE_URL ?? 'http://localhost:4003') + '/api/deals/health' },
      ],
    }),
    DynamoDbModule,
    RedisModule,
    AuthModule,
    EventsModule.forRoot({
      publisher: {
        region: process.env.AWS_REGION,
        endpoint: process.env.AWS_ENDPOINT,
        source: 'telephony-service',
        topicArns: process.env.CALL_EVENTS_TOPIC_ARN
          ? { 'call-events': process.env.CALL_EVENTS_TOPIC_ARN }
          : {},
      },
      consumer: DEAL_EVENTS_QUEUE_URL
        ? {
            region: AWS_REGION,
            endpoint: AWS_ENDPOINT,
            queueUrl: DEAL_EVENTS_QUEUE_URL,
            waitTimeSeconds: 20,
            maxMessages: 10,
          }
        : undefined,
    }),
    TelephonyModule,
    PresenceModule,
    // Catalog before the calls module, per the route-order rule in CLAUDE.md §4.
    CallTagsModule,
    // Workiz Phone → Blocked callers (its own prefix; the inbound webhook asks it).
    BlockedCallersModule,
    // Reports → Call Tracking: `calls/stats/tracking`, ahead of CallsController's `:sid` routes.
    CallTrackingModule,
    CallsModule,
    VoiceModule,
    ExtsModule,
    NumbersModule,
    // The Devices catalog (`devices`) before the groups and flows that ring it.
    CallDevicesModule,
    CallGroupsModule,
    CallFlowsModule,
  ],
  controllers: [AppController],
  providers: [DbSetupService],
})
export class AppModule implements OnModuleInit {
  constructor(@Optional() private readonly sqsConsumer?: SqsConsumerService) {}

  onModuleInit() {
    if (!this.sqsConsumer) return;
    // deal-events handlers are registered by CallDealEventsHandler.onModuleInit.
    if (process.env.ENABLE_SQS_CONSUMER === 'true') {
      this.sqsConsumer.start();
    }
  }
}
