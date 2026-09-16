import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service, SqsConsumerService } from '@bitcrm/shared';
import { AUTOMATIONS_CONFIG } from '../../../src/automations/automations.config';
import { AutomationsService } from '../../../src/automations/automations.service';
import {
  AutomationsModule,
  CALL_EVENTS_SQS_CONSUMER,
  DEAL_EVENTS_SQS_CONSUMER,
} from '../../../src/automations/automations.module';
import {
  CALL_COMPLETED_EVENT,
  DEAL_CREATED_EVENT,
  DEAL_SCHEDULED_CHANGED_EVENT,
  DEAL_STATUS_CHANGED_EVENT,
  DEAL_TECH_ASSIGNED_EVENT,
  DEAL_UPDATED_EVENT,
} from '../../../src/automations/deal-events';
import { AutomationDealEventsHandler } from '../../../src/automations/engine/deal-events.handler';
import { AutomationRuleEngine } from '../../../src/automations/engine/rule-engine.service';
import { NewJobSmsService } from '../../../src/automations/new-job-sms.service';
import { TechNoticesService } from '../../../src/automations/tech-notices.service';

/** The platform globals AppModule provides (see outbound.module.spec.ts). */
@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send: jest.fn().mockResolvedValue({}) } } },
    { provide: S3Service, useValue: {} },
    { provide: RedisService, useValue: { client: { publish: jest.fn().mockResolvedValue(1), duplicate: jest.fn() } } },
    { provide: PermissionCacheReader, useValue: { get: jest.fn().mockResolvedValue(null) } },
  ],
  exports: [DynamoDbService, S3Service, RedisService, PermissionCacheReader],
})
class FakePlatformModule {}

describe('AutomationsModule wiring', () => {
  const saved = {
    queue: process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL,
    calls: process.env.CALL_EVENTS_TO_MESSAGING_QUEUE_URL,
    outbound: process.env.MESSAGING_OUTBOUND_QUEUE_URL,
    enable: process.env.ENABLE_SQS_CONSUMER,
    scheduler: process.env.ENABLE_AUTOMATION_SCHEDULER,
  };
  beforeEach(() => {
    delete process.env.MESSAGING_OUTBOUND_QUEUE_URL;
    delete process.env.ENABLE_SQS_CONSUMER;
    delete process.env.ENABLE_AUTOMATION_SCHEDULER;
  });
  afterEach(() => {
    for (const [key, value] of [
      ['DEAL_EVENTS_TO_MESSAGING_QUEUE_URL', saved.queue],
      ['CALL_EVENTS_TO_MESSAGING_QUEUE_URL', saved.calls],
      ['MESSAGING_OUTBOUND_QUEUE_URL', saved.outbound],
      ['ENABLE_SQS_CONSUMER', saved.enable],
      ['ENABLE_AUTOMATION_SCHEDULER', saved.scheduler],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves every provider with only the platform globals; no queue URL → no consumer', async () => {
    delete process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL;
    delete process.env.CALL_EVENTS_TO_MESSAGING_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(AutomationsService)).toBeInstanceOf(AutomationsService);
    expect(moduleRef.get(NewJobSmsService)).toBeInstanceOf(NewJobSmsService);
    expect(moduleRef.get(TechNoticesService)).toBeInstanceOf(TechNoticesService);
    expect(moduleRef.get(AutomationRuleEngine)).toBeInstanceOf(AutomationRuleEngine);
    expect(moduleRef.get(AutomationDealEventsHandler)).toBeInstanceOf(AutomationDealEventsHandler);
    expect(moduleRef.get(AUTOMATIONS_CONFIG)).toMatchObject({
      awsRegion: expect.any(String),
      consumerEnabled: false,
      schedulerEnabled: false,
      schedulerIntervalMs: 60_000,
    });
    expect(moduleRef.get(DEAL_EVENTS_SQS_CONSUMER)).toBeNull();
    expect(moduleRef.get(CALL_EVENTS_SQS_CONSUMER)).toBeNull();

    await moduleRef.close();
  });

  it('with a queue URL, registers every job event on a dedicated consumer and polls only when enabled', async () => {
    process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL = 'http://localhost:4566/000000000000/deal-events-to-messaging';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    const consumer = moduleRef.get<SqsConsumerService>(DEAL_EVENTS_SQS_CONSUMER);
    expect(consumer).toBeInstanceOf(SqsConsumerService);
    const start = jest.spyOn(consumer, 'start').mockImplementation(() => undefined);

    await moduleRef.init();
    const handlers = consumer.getHandlers();
    for (const event of [
      DEAL_CREATED_EVENT,
      DEAL_UPDATED_EVENT,
      DEAL_STATUS_CHANGED_EVENT,
      DEAL_TECH_ASSIGNED_EVENT,
      DEAL_SCHEDULED_CHANGED_EVENT,
    ]) {
      expect(handlers.has(event)).toBe(true);
    }
    expect(start).not.toHaveBeenCalled(); // ENABLE_SQS_CONSUMER unset

    // The built-in New-job SMS still runs first, then the rule engine.
    const events = moduleRef.get(AutomationDealEventsHandler);
    const assigned = jest.spyOn(events, 'onTechAssigned').mockResolvedValue(undefined);
    const updated = jest.spyOn(events, 'onDealUpdated').mockResolvedValue(undefined);
    await handlers.get(DEAL_TECH_ASSIGNED_EVENT)!({ dealId: 'd1', techId: 't1', assignedBy: 'u1' });
    await handlers.get(DEAL_UPDATED_EVENT)!({ dealId: 'd1', updatedBy: 'u1' });
    expect(assigned).toHaveBeenCalledWith({ dealId: 'd1', techId: 't1', assignedBy: 'u1' });
    expect(updated).toHaveBeenCalledWith({ dealId: 'd1', updatedBy: 'u1' });

    await moduleRef.close();
  });

  it('registers call.completed on its own consumer when that queue is configured', async () => {
    process.env.CALL_EVENTS_TO_MESSAGING_QUEUE_URL = 'http://localhost:4566/000000000000/call-events-to-messaging';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    const consumer = moduleRef.get<SqsConsumerService>(CALL_EVENTS_SQS_CONSUMER);
    jest.spyOn(consumer, 'start').mockImplementation(() => undefined);
    await moduleRef.init();

    expect(consumer.getHandlers().has(CALL_COMPLETED_EVENT)).toBe(true);
    await moduleRef.close();
  });

  it('polls the scheduler only under ENABLE_AUTOMATION_SCHEDULER', async () => {
    jest.useFakeTimers();
    process.env.ENABLE_AUTOMATION_SCHEDULER = 'true';
    process.env.AUTOMATION_SCHEDULER_INTERVAL_MS = '1000';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    const engine = moduleRef.get(AutomationRuleEngine);
    const tick = jest.spyOn(engine, 'tick').mockResolvedValue(0);

    await moduleRef.init();
    jest.advanceTimersByTime(2_500);
    expect(tick).toHaveBeenCalledTimes(2);

    await moduleRef.close();
    jest.advanceTimersByTime(5_000);
    expect(tick).toHaveBeenCalledTimes(2); // stopped with the module
    jest.useRealTimers();
    delete process.env.AUTOMATION_SCHEDULER_INTERVAL_MS;
  });
});
