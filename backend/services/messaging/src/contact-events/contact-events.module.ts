import { Logger, Module, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { ConversationsModule } from '../conversations/conversations.module';
import { CrmContactsClient } from '../outbound/internal/crm-contacts.client';
import { ContactEventsHandler } from './contact-events.handler';
import { CONTACT_MERGED_EVENT, CONTACT_UPDATED_EVENT } from './contact-events.payloads';
import { ContactPointersRepository } from './contact-pointers.repository';

/**
 * The `contact-events-to-messaging` consumer (EVENTS.md). The queue's
 * `SqsConsumerService` is the one `EventsModule.forRoot({ consumer })` in
 * `AppModule` provides globally — present only when
 * `CONTACT_EVENTS_TO_MESSAGING_QUEUE_URL` is set — so the handlers register
 * here and `AppModule` keeps the single `start()` under
 * `ENABLE_SQS_CONSUMER=true`. Nest initialises imported modules before the
 * root, so registration precedes polling; a handler registered later would
 * still be picked up, the map is read per message.
 */
@Module({
  imports: [ConversationsModule],
  providers: [ContactPointersRepository, CrmContactsClient, ContactEventsHandler],
  exports: [ContactEventsHandler],
})
export class ContactEventsModule implements OnModuleInit {
  private readonly logger = new Logger(ContactEventsModule.name);

  constructor(
    private readonly handler: ContactEventsHandler,
    @Optional() private readonly sqsConsumer?: SqsConsumerService,
  ) {}

  onModuleInit() {
    if (!this.sqsConsumer) {
      this.logger.warn('CONTACT_EVENTS_TO_MESSAGING_QUEUE_URL is not set: contact.merged / contact.updated are not consumed');
      return;
    }
    this.sqsConsumer.registerHandler(CONTACT_MERGED_EVENT, (payload) => this.handler.onContactMerged(payload));
    this.sqsConsumer.registerHandler(CONTACT_UPDATED_EVENT, (payload) => this.handler.onContactUpdated(payload));
  }
}
