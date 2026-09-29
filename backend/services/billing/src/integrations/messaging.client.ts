import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import { MESSAGING_SERVICE_URL } from '../common/constants/services.constants';
import { INTERNAL_FETCH, InternalHttp, defaultFetch, type FetchLike } from './internal-http';

export interface SendClientMessage {
  contactId: string;
  channel: 'sms' | 'email';
  body: string;
  /** Email only. */
  subject?: string;
}

/**
 * Messaging owns every outbound client message (Twilio, the client's thread),
 * so billing never texts or emails anyone itself — it asks messaging, on the
 * CALLER's bearer, exactly as the web app's "Send by text" dialog does.
 * `POST /api/messaging/messages` opens or reuses the contact's conversation.
 */
@Injectable()
export class MessagingClient {
  private readonly http: InternalHttp;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) fetchImpl?: FetchLike,
    @Optional() metrics?: BusinessMetricsService,
  ) {
    this.http = new InternalHttp('messaging', MESSAGING_SERVICE_URL, fetchImpl ?? defaultFetch, metrics);
  }

  async sendToContact(message: SendClientMessage, authorization: string): Promise<void> {
    await this.http.request('/api/messaging/messages', {
      method: 'POST',
      body: {
        clientMessageId: randomUUID(),
        channel: message.channel,
        body: message.body,
        ...(message.subject && { subject: message.subject }),
        contactId: message.contactId,
      },
      operation: 'sendClientMessage',
      headers: { authorization },
      timeoutMs: 15_000,
    });
  }
}
