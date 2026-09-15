import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, S3Service, TWILIO_CONFIG, TwilioRest } from '@bitcrm/shared';
import { OutboundModule } from '../../../src/outbound/outbound.module';
import { OutboundQueueProducer } from '../../../src/outbound/outbound-queue.producer';
import { SendService } from '../../../src/outbound/send.service';
import { SenderResolver } from '../../../src/outbound/sender.resolver';
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
  it('resolves the send path, the resolver and the Twilio primitives', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, OutboundModule] }).compile();

    expect(moduleRef.get(SendService)).toBeInstanceOf(SendService);
    expect(moduleRef.get(SenderResolver)).toBeInstanceOf(SenderResolver);
    expect(moduleRef.get(OutboundQueueProducer).configured).toBe(false);
    expect(moduleRef.get(TwilioRest)).toBeInstanceOf(TwilioRest);
    expect(moduleRef.get(TWILIO_CONFIG)).toMatchObject({ validateSignature: expect.any(Boolean) });
    expect(moduleRef.get(OUTBOUND_CONFIG)).toMatchObject({ awsRegion: expect.any(String), mediaUrlTtlSeconds: 3600 });

    await moduleRef.close();
  });
});
