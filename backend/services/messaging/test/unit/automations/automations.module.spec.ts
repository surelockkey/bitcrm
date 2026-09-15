import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service, SqsConsumerService } from '@bitcrm/shared';
import { AUTOMATIONS_CONFIG } from '../../../src/automations/automations.config';
import { AutomationsService } from '../../../src/automations/automations.service';
import { AutomationsModule, DEAL_EVENTS_SQS_CONSUMER } from '../../../src/automations/automations.module';
import { DEAL_TECH_ASSIGNED_EVENT, DEAL_UPDATED_EVENT } from '../../../src/automations/deal-events';
import { NewJobSmsService } from '../../../src/automations/new-job-sms.service';
import { TechNoticesService } from '../../../src/automations/tech-notices.service';

/** The platform globals AppModule provides (see outbound.module.spec.ts). */
@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send: jest.fn() } } },
    { provide: S3Service, useValue: {} },
    { provide: RedisService, useValue: { client: { publish: jest.fn().mockResolvedValue(1), duplicate: jest.fn() } } },
    { provide: PermissionCacheReader, useValue: { get: jest.fn().mockResolvedValue(null) } },
  ],
  exports: [DynamoDbService, S3Service, RedisService, PermissionCacheReader],
})
class FakePlatformModule {}

describe('AutomationsModule wiring', () => {
  const saved = { queue: process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL, outbound: process.env.MESSAGING_OUTBOUND_QUEUE_URL, enable: process.env.ENABLE_SQS_CONSUMER };
  beforeEach(() => {
    delete process.env.MESSAGING_OUTBOUND_QUEUE_URL;
    delete process.env.ENABLE_SQS_CONSUMER;
  });
  afterEach(() => {
    for (const [key, value] of [
      ['DEAL_EVENTS_TO_MESSAGING_QUEUE_URL', saved.queue],
      ['MESSAGING_OUTBOUND_QUEUE_URL', saved.outbound],
      ['ENABLE_SQS_CONSUMER', saved.enable],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves every provider with only the platform globals; no queue URL → no consumer', async () => {
    delete process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(AutomationsService)).toBeInstanceOf(AutomationsService);
    expect(moduleRef.get(NewJobSmsService)).toBeInstanceOf(NewJobSmsService);
    expect(moduleRef.get(TechNoticesService)).toBeInstanceOf(TechNoticesService);
    expect(moduleRef.get(AUTOMATIONS_CONFIG)).toMatchObject({ awsRegion: expect.any(String), consumerEnabled: false });
    expect(moduleRef.get(DEAL_EVENTS_SQS_CONSUMER)).toBeNull();

    await moduleRef.close();
  });

  it('with a queue URL, registers deal.tech_assigned / deal.updated on a dedicated consumer and polls only when enabled', async () => {
    process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL = 'http://localhost:4566/000000000000/deal-events-to-messaging';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, AutomationsModule] }).compile();
    const consumer = moduleRef.get<SqsConsumerService>(DEAL_EVENTS_SQS_CONSUMER);
    expect(consumer).toBeInstanceOf(SqsConsumerService);
    const start = jest.spyOn(consumer, 'start').mockImplementation(() => undefined);

    await moduleRef.init();
    const handlers = consumer.getHandlers();
    expect(handlers.has(DEAL_TECH_ASSIGNED_EVENT)).toBe(true);
    expect(handlers.has(DEAL_UPDATED_EVENT)).toBe(true);
    expect(start).not.toHaveBeenCalled(); // ENABLE_SQS_CONSUMER unset

    const newJob = moduleRef.get(NewJobSmsService);
    const assigned = jest.spyOn(newJob, 'onTechAssigned').mockResolvedValue(undefined);
    const updated = jest.spyOn(newJob, 'onDealUpdated').mockResolvedValue(undefined);
    await handlers.get(DEAL_TECH_ASSIGNED_EVENT)!({ dealId: 'd1', techId: 't1', assignedBy: 'u1' });
    await handlers.get(DEAL_UPDATED_EVENT)!({ dealId: 'd1', updatedBy: 'u1' });
    expect(assigned).toHaveBeenCalledWith({ dealId: 'd1', techId: 't1', assignedBy: 'u1' });
    expect(updated).toHaveBeenCalledWith({ dealId: 'd1', updatedBy: 'u1' });

    await moduleRef.close();
  });
});
