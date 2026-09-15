import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, PermissionCacheReader, RedisService, S3Service } from '@bitcrm/shared';
import { EmailAddressResolver } from '../../../src/email/email-address.resolver';
import { EmailOutboundWorker } from '../../../src/email/email-outbound.worker';
import { EmailSender, SES_CLIENT } from '../../../src/email/email-sender';
import { EMAIL_CONFIG } from '../../../src/email/email.config';
import { EMAIL_EVENTS_POLLER, EmailModule } from '../../../src/email/email.module';
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
    for (const k of ['MESSAGING_EMAIL_FROM', 'MESSAGING_EMAIL_EVENTS_QUEUE_URL', 'ENABLE_SQS_CONSUMER']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('compiles with only the platform globals; unconfigured email means no sender and no poller', async () => {
    delete process.env.MESSAGING_EMAIL_FROM;
    delete process.env.MESSAGING_EMAIL_EVENTS_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, EmailModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(EmailAddressResolver).configured).toBe(false);
    expect(moduleRef.get(EmailSender)).toBeInstanceOf(EmailSender);
    expect(moduleRef.get(EmailOutboundWorker)).toBeInstanceOf(EmailOutboundWorker);
    expect(moduleRef.get(SesEventsHandler)).toBeInstanceOf(SesEventsHandler);
    expect(moduleRef.get(SES_CLIENT)).toBeDefined();
    expect(moduleRef.get(EMAIL_CONFIG)).toMatchObject({ awsRegion: expect.any(String), consumerEnabled: false });
    expect(moduleRef.get(EMAIL_EVENTS_POLLER)).toBeNull();
    await moduleRef.close();
  });

  it('with a queue URL builds the events poller and starts it only when consumption is enabled', async () => {
    process.env.MESSAGING_EMAIL_FROM = 'office@example.com';
    process.env.MESSAGING_EMAIL_EVENTS_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-email-events';
    delete process.env.ENABLE_SQS_CONSUMER;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, EmailModule] }).compile();
    const poller = moduleRef.get<SqsPoller>(EMAIL_EVENTS_POLLER);
    expect(poller).toBeInstanceOf(SqsPoller);
    const start = jest.spyOn(poller, 'start').mockImplementation(() => undefined);
    await moduleRef.init();
    expect(start).not.toHaveBeenCalled();
    expect(moduleRef.get(EmailAddressResolver).configured).toBe(true);
    await moduleRef.close();
  });
});
