import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDbService, SqsConsumerService } from '@bitcrm/shared';
import { ContactEventsHandler } from '../../../src/contact-events/contact-events.handler';
import { ContactEventsModule } from '../../../src/contact-events/contact-events.module';
import { CONTACT_MERGED_EVENT, CONTACT_UPDATED_EVENT } from '../../../src/contact-events/contact-events.payloads';

@Global()
@Module({
  providers: [{ provide: DynamoDbService, useValue: { client: { send: jest.fn() } } }],
  exports: [DynamoDbService],
})
class FakePlatformModule {}

/** Stands in for `EventsModule.forRoot({ consumer })` — the global contact-events consumer. */
function fakeConsumerModule(consumer: SqsConsumerService) {
  @Global()
  @Module({ providers: [{ provide: SqsConsumerService, useValue: consumer }], exports: [SqsConsumerService] })
  class FakeEventsModule {}
  return FakeEventsModule;
}

describe('ContactEventsModule wiring', () => {
  it('registers contact.merged / contact.updated on the global consumer and dispatches to the handler', async () => {
    const consumer = new SqsConsumerService({ queueUrl: 'http://localhost:4566/000000000000/contact-events-to-messaging' });
    const moduleRef = await Test.createTestingModule({
      imports: [FakePlatformModule, fakeConsumerModule(consumer), ContactEventsModule],
    }).compile();
    await moduleRef.init();

    const handlers = consumer.getHandlers();
    expect(handlers.has(CONTACT_MERGED_EVENT)).toBe(true);
    expect(handlers.has(CONTACT_UPDATED_EVENT)).toBe(true);

    const handler = moduleRef.get(ContactEventsHandler);
    const merged = jest.spyOn(handler, 'onContactMerged').mockResolvedValue(undefined);
    const updated = jest.spyOn(handler, 'onContactUpdated').mockResolvedValue(undefined);
    await handlers.get(CONTACT_MERGED_EVENT)!({ oldContactId: 'a', newContactId: 'b' });
    await handlers.get(CONTACT_UPDATED_EVENT)!({ contactId: 'b' });
    expect(merged).toHaveBeenCalledWith({ oldContactId: 'a', newContactId: 'b' });
    expect(updated).toHaveBeenCalledWith({ contactId: 'b' });

    await moduleRef.close();
  });

  it('compiles without the consumer (no CONTACT_EVENTS_TO_MESSAGING_QUEUE_URL)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakePlatformModule, ContactEventsModule] }).compile();
    await moduleRef.init();
    expect(moduleRef.get(ContactEventsHandler)).toBeInstanceOf(ContactEventsHandler);
    await moduleRef.close();
  });
});
