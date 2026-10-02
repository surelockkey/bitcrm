import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import type { PortalEventRequest } from '@bitcrm/types';
import { MESSAGING_SERVICE_URL } from '../common/constants/services.constants';
import { INTERNAL_FETCH, InternalHttp, defaultFetch, type FetchLike } from './internal-http';

export interface SendClientMessage {
  contactId: string;
  channel: 'sms' | 'email';
  body: string;
  /** Email only. */
  subject?: string;
  /**
   * The address to use instead of the thread's first: an email — taken onto
   * the client's thread when it is new to it (messaging does that for a client
   * thread) — or one of the client's numbers.
   */
  toAddress?: string;
  /** The job it is about: messaging files the message under it and checks an `assigned_only` sender against its roster. */
  dealId?: string;
}

/** A text to a bare number that is not one of the client's. */
export interface SendNumberMessage {
  /** E.164. */
  phone: string;
  body: string;
  dealId?: string;
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
        ...(message.toAddress && { toAddress: message.toAddress }),
        ...(message.dealId && { dealId: message.dealId }),
      },
      operation: 'sendClientMessage',
      headers: { authorization },
      timeoutMs: 15_000,
    });
  }

  /**
   * A text to a number that is not one of the client's (typed on the phone):
   * messaging routes it as it routes any bare number — the thread that number
   * already has, its owner's in CRM, or a new one keyed by it — and never
   * adds the number to the client's thread.
   */
  async sendToNumber(message: SendNumberMessage, authorization: string): Promise<void> {
    await this.http.request('/api/messaging/messages', {
      method: 'POST',
      body: {
        clientMessageId: randomUUID(),
        channel: 'sms',
        body: message.body,
        phone: message.phone,
        ...(message.dealId && { dealId: message.dealId }),
      },
      operation: 'sendNumberMessage',
      headers: { authorization },
      timeoutMs: 15_000,
    });
  }

  /**
   * What the client just did on the portal — viewed a document, signed it,
   * declined an estimate, paid — for messaging to write into their thread as
   * a system line (Workiz shows these in the chat). Service to service, on
   * the internal secret: the client has no bearer and nobody on staff acted.
   */
  async recordPortalEvent(event: PortalEventRequest): Promise<void> {
    await this.http.request('/api/messaging/internal/portal-events', {
      method: 'POST',
      body: event,
      operation: 'recordPortalEvent',
      timeoutMs: 5_000,
    });
  }
}
