import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { SqsConsumerService } from '@bitcrm/shared';
import { ContactLookupService } from '../common/contact-lookup.service';

/**
 * contact-events consumed from telephony's queue (`deal-events-to-telephony`
 * subscribes to `contact-events` as well — the shared consumer takes one
 * queue URL, the way deal-service's `user-events-to-deal` carries two
 * topics).
 */
export const CALL_CONTACT_EVENT_TYPES = [
  'contact.created',
  'contact.updated',
  'contact.merged',
  'company.created',
  'company.updated',
] as const;

interface ContactEventPayload {
  contactId?: string;
  companyId?: string;
  oldContactId?: string;
  newContactId?: string;
}

/**
 * Drops a client's numbers and name from the caller-name cache when the CRM
 * says the client was created or changed — an unknown number is cached five
 * minutes, and "Add client" on a call must show the new client at once.
 * Best effort: never throws (a cache entry that is not cleared just expires),
 * so a CRM blip never sends the message to the DLQ.
 */
@Injectable()
export class CallContactEventsHandler implements OnModuleInit {
  private readonly logger = new Logger(CallContactEventsHandler.name);

  constructor(
    private readonly contacts: ContactLookupService,
    @Optional() private readonly consumer?: SqsConsumerService,
  ) {}

  onModuleInit(): void {
    if (!this.consumer || !process.env.DEAL_EVENTS_TO_TELEPHONY_QUEUE_URL) return;
    for (const type of CALL_CONTACT_EVENT_TYPES) {
      this.consumer.registerHandler(type, (payload) => this.handle(type, payload as ContactEventPayload));
    }
  }

  async handle(type: string, payload: ContactEventPayload): Promise<void> {
    try {
      if (type === 'contact.merged') {
        for (const id of [payload?.oldContactId, payload?.newContactId]) {
          if (id) await this.contacts.forgetContact(id);
        }
      } else if (type.startsWith('contact.')) {
        if (payload?.contactId) await this.contacts.forgetContact(payload.contactId);
      } else if (payload?.companyId) {
        await this.contacts.forgetCompany(payload.companyId);
      }
    } catch (err) {
      this.logger.warn(`${type}: caller-name cache not cleared — ${err instanceof Error ? err.message : err}`);
    }
  }
}
