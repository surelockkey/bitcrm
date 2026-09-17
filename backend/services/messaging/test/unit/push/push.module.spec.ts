import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service } from '@bitcrm/shared';
import { ExpoPushService } from '../../../src/push/expo-push.service';
import { PushDevicesController } from '../../../src/push/push-devices.controller';
import { PushDevicesRepository } from '../../../src/push/push-devices.repository';
import { PushNotifierService } from '../../../src/push/push-notifier.service';
import { PUSH_CONFIG, type PushConfig } from '../../../src/push/push.config';
import { PushModule } from '../../../src/push/push.module';
import { SendService } from '../../../src/outbound/send.service';
import { OutboundModule } from '../../../src/outbound/outbound.module';
import { AutomationsModule } from '../../../src/automations/automations.module';
import { SendToTechService } from '../../../src/automations/send-to-tech.service';

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

describe('PushModule wiring', () => {
  const saved = process.env.PUSH_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.PUSH_ENABLED;
    else process.env.PUSH_ENABLED = saved;
  });

  it('resolves the registry, the transport and the notifier with nothing but the platform globals', async () => {
    delete process.env.PUSH_ENABLED;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, PushModule] }).compile();

    expect(moduleRef.get(PushDevicesRepository)).toBeInstanceOf(PushDevicesRepository);
    expect(moduleRef.get(ExpoPushService)).toBeInstanceOf(ExpoPushService);
    expect(moduleRef.get(PushNotifierService)).toBeInstanceOf(PushNotifierService);
    expect(moduleRef.get(PushDevicesController)).toBeInstanceOf(PushDevicesController);
    // Off unless asked for: the service must be deployable before the
    // owner's Apple and Google accounts exist.
    expect(moduleRef.get<PushConfig>(PUSH_CONFIG).enabled).toBe(false);
    expect(moduleRef.get(ExpoPushService).enabled).toBe(false);
  });

  it('hands the notifier to both senders — the chat line and the job', async () => {
    delete process.env.DEAL_EVENTS_TO_MESSAGING_QUEUE_URL;
    delete process.env.CALL_EVENTS_TO_MESSAGING_QUEUE_URL;
    delete process.env.MESSAGING_OUTBOUND_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({
      imports: [FakePlatformModule, OutboundModule, AutomationsModule],
    }).compile();
    await moduleRef.init();

    // Both are @Optional() so the existing unit tests can build them with
    // fewer arguments; wired up for real, both must actually receive it.
    expect((moduleRef.get(SendService) as any).push).toBeInstanceOf(PushNotifierService);
    expect((moduleRef.get(SendToTechService) as any).push).toBeInstanceOf(PushNotifierService);

    await moduleRef.close();
  });
});
