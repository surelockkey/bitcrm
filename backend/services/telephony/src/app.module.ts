import { Module } from '@nestjs/common';
import {
  DynamoDbModule,
  RedisModule,
  AuthModule,
  EventsModule,
  LoggerModule,
  MetricsModule,
  HealthModule,
  ConnectivityModule,
} from '@bitcrm/shared';
import { AppController } from './app.controller';
import { TelephonyModule } from './telephony/telephony.module';
import { PresenceModule } from './presence/presence.module';
import { CallsModule } from './calls/calls.module';
import { VoiceModule } from './voice/voice.module';
import { ExtsModule } from './exts/exts.module';
import { NumbersModule } from './numbers/numbers.module';
import { CallGroupsModule } from './call-groups/call-groups.module';
import { CallFlowsModule } from './call-flows/call-flows.module';
import { DbSetupService } from './common/db-setup.service';
import { CALLS_TABLE } from './common/constants/dynamo.constants';
import { CALL_GROUPS_TABLE } from './call-groups/call-groups.constants';
import { CALL_FLOWS_TABLE } from './call-flows/call-flows.constants';

@Module({
  imports: [
    LoggerModule.forRoot({ serviceName: 'telephony-service' }),
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
    }),
    TelephonyModule,
    PresenceModule,
    CallsModule,
    VoiceModule,
    ExtsModule,
    NumbersModule,
    CallGroupsModule,
    CallFlowsModule,
  ],
  controllers: [AppController],
  providers: [DbSetupService],
})
export class AppModule {}
