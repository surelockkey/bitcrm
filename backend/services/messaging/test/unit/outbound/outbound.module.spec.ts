import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, S3Service, SqsConsumerService, TWILIO_CONFIG, TwilioRest } from '@bitcrm/shared';
import { OUTBOUND_SQS_CONSUMER, OutboundModule } from '../../../src/outbound/outbound.module';
import { OUTBOUND_JOB_EVENT, OutboundQueueProducer } from '../../../src/outbound/outbound-queue.producer';
import { OutboundWorker } from '../../../src/outbound/outbound.worker';
import { SendService } from '../../../src/outbound/send.service';
import { SenderResolver } from '../../../src/outbound/sender.resolver';
import { StatusCallbackService } from '../../../src/outbound/status-callback.service';
import { OUTBOUND_CONFIG } from '../../../src/outbound/outbound.config';

/** Stands in for the platform modules AppModule provides globally. */
@Global()
@Module({
  providers: [
    { provide: DynamoDbService, useValue: { client: { send: jest.fn() } } },
    { provide: S3Service, useValue: {} },
  ],
  exports: [DynamoDbService, S3Service],
})
class FakePlatformModule {}

/**
 * The module must compile with only the platform globals present: every
 * provider resolvable, the optional ones (SNS publisher, template renderer,
 * SQS client, fetch override) genuinely optional.
 */
describe('OutboundModule wiring', () => {
  const queueUrl = process.env.MESSAGING_OUTBOUND_QUEUE_URL;
  afterEach(() => {
    if (queueUrl === undefined) delete process.env.MESSAGING_OUTBOUND_QUEUE_URL;
    else process.env.MESSAGING_OUTBOUND_QUEUE_URL = queueUrl;
    delete process.env.ENABLE_SQS_CONSUMER;
  });

  it('resolves the send path, the worker, the callback and the Twilio primitives; no queue → in-process worker', async () => {
    delete process.env.MESSAGING_OUTBOUND_QUEUE_URL;
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, OutboundModule] }).compile();
    await moduleRef.init();

    expect(moduleRef.get(SendService)).toBeInstanceOf(SendService);
    expect(moduleRef.get(SenderResolver)).toBeInstanceOf(SenderResolver);
    expect(moduleRef.get(OutboundWorker)).toBeInstanceOf(OutboundWorker);
    expect(moduleRef.get(StatusCallbackService)).toBeInstanceOf(StatusCallbackService);
    expect(moduleRef.get(TwilioRest)).toBeInstanceOf(TwilioRest);
    expect(moduleRef.get(TWILIO_CONFIG)).toMatchObject({ validateSignature: expect.any(Boolean) });
    expect(moduleRef.get(OUTBOUND_CONFIG)).toMatchObject({ awsRegion: expect.any(String), mediaUrlTtlSeconds: 3600 });
    expect(moduleRef.get(OUTBOUND_SQS_CONSUMER)).toBeNull();

    const producer = moduleRef.get(OutboundQueueProducer);
    expect(producer.configured).toBe(false);
    // the worker registered itself as the inline handler
    const worker = moduleRef.get(OutboundWorker);
    const processJob = jest.spyOn(worker, 'process').mockResolvedValue(undefined);
    await producer.enqueue({ conversationId: 'c1', createdAt: 't', messageId: 'm' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(processJob).toHaveBeenCalled();

    await moduleRef.close();
  });

  it('with a queue URL, registers the worker on a dedicated consumer and polls only when enabled', async () => {
    process.env.MESSAGING_OUTBOUND_QUEUE_URL = 'http://localhost:4566/000000000000/messaging-outbound.fifo';
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, OutboundModule] }).compile();
    const consumer = moduleRef.get<SqsConsumerService>(OUTBOUND_SQS_CONSUMER);
    expect(consumer).toBeInstanceOf(SqsConsumerService);
    const start = jest.spyOn(consumer, 'start').mockImplementation(() => undefined);

    await moduleRef.init();
    expect(consumer.getHandlers().has(OUTBOUND_JOB_EVENT)).toBe(true);
    expect(start).not.toHaveBeenCalled(); // ENABLE_SQS_CONSUMER unset
    expect(moduleRef.get(OutboundQueueProducer).configured).toBe(true);

    await moduleRef.close();
  });
});
