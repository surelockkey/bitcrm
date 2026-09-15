import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service } from '@bitcrm/shared';
import { EmailAddressResolver } from '../../../src/email/email-address.resolver';
import { EmailOutboundWorker } from '../../../src/email/email-outbound.worker';
import { EmailSender, SES_CLIENT } from '../../../src/email/email-sender';
import { EMAIL_CONFIG } from '../../../src/email/email.config';
import { EMAIL_EVENTS_POLLER, INBOUND_EMAIL_POLLER, EmailModule } from '../../../src/email/email.module';
import { EmailThreadResolver } from '../../../src/email/inbound/email-thread.resolver';
import { InboundEmailService } from '../../../src/email/inbound/inbound-email.service';
import { SesEventsHandler } from '../../../src/email/ses-events.handler';
import { SqsPoller } from '../../../src/email/sqs-poller';

/** The platform globals AppModule provides (DynamoDB, S3, Redis, the permission cache reader). */
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

describe('EmailModule wiring', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ['MESSAGING_EMAIL_FROM', 'MESSAGING_EMAIL_EVENTS_QUEUE_URL', 'MESSAGING_INBOUND_EMAIL_QUEUE_URL', 'ENABLE_SQS_CONSUMER']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('compiles with only the platform globals; unconfigured email means no sender and no poller', async () => {
    delete process.env.MESSAGING_EMAIL_FROM;
    delete process.env.MESSAGING_EMAIL_EVENTS_QUEUE_URL;
    delete process.env.MESSAGING_INBOUND_EMAIL_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, EmailModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(EmailAddressResolver).configured).toBe(false);
    expect(moduleRef.get(EmailSender)).toBeInstanceOf(EmailSender);
    expect(moduleRef.get(EmailOutboundWorker)).toBeInstanceOf(EmailOutboundWorker);
    expect(moduleRef.get(SesEventsHandler)).toBeInstanceOf(SesEventsHandler);
    expect(moduleRef.get(SES_CLIENT)).toBeDefined();
    expect(moduleRef.get(EMAIL_CONFIG)).toMatchObject({ awsRegion: expect.any(String), consumerEnabled: false });
    expect(moduleRef.get(EMAIL_EVENTS_POLLER)).toBeNull();
    expect(moduleRef.get(INBOUND_EMAIL_POLLER)).toBeNull();
    expect(moduleRef.get(InboundEmailService)).toBeInstanceOf(InboundEmailService);
    expect(moduleRef.get(EmailThreadResolver)).toBeInstanceOf(EmailThreadResolver);
    await moduleRef.close();
  });

  it('with queue URLs builds both pollers and starts them only when consumption is enabled', async () => {
    process.env.MESSAGING_EMAIL_FROM = 'office@example.com';
    process.env.MESSAGING_EMAIL_EVENTS_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-email-events';
    process.env.MESSAGING_INBOUND_EMAIL_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-inbound-email';
    delete process.env.ENABLE_SQS_CONSUMER;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, EmailModule] }).compile();
    const events = moduleRef.get<SqsPoller>(EMAIL_EVENTS_POLLER);
    const inbound = moduleRef.get<SqsPoller>(INBOUND_EMAIL_POLLER);
    expect(events).toBeInstanceOf(SqsPoller);
    expect(inbound).toBeInstanceOf(SqsPoller);
    expect(inbound.queueUrl).toMatch(/messaging-inbound-email$/);
    const starts = [jest.spyOn(events, 'start').mockImplementation(() => undefined), jest.spyOn(inbound, 'start').mockImplementation(() => undefined)];
    await moduleRef.init();
    for (const start of starts) expect(start).not.toHaveBeenCalled();
    expect(moduleRef.get(EmailAddressResolver).configured).toBe(true);
    await moduleRef.close();
  });

  it('starts both pollers under ENABLE_SQS_CONSUMER=true and stops them on destroy', async () => {
    process.env.MESSAGING_EMAIL_EVENTS_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-email-events';
    process.env.MESSAGING_INBOUND_EMAIL_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-inbound-email';
    process.env.ENABLE_SQS_CONSUMER = 'true';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, EmailModule] }).compile();
    const pollers = [moduleRef.get<SqsPoller>(EMAIL_EVENTS_POLLER), moduleRef.get<SqsPoller>(INBOUND_EMAIL_POLLER)];
    const starts = pollers.map((p) => jest.spyOn(p, 'start').mockImplementation(() => undefined));
    const stops = pollers.map((p) => jest.spyOn(p, 'stop'));
    await moduleRef.init();
    for (const start of starts) expect(start).toHaveBeenCalledTimes(1);
    await moduleRef.close();
    for (const stop of stops) expect(stop).toHaveBeenCalled();
  });
});
