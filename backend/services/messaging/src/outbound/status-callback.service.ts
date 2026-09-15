import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { TWILIO_CONFIG, type TwilioConfig } from '@bitcrm/shared';
import { isTerminalMessageStatus } from '@bitcrm/types';
import { parseMessageSk } from '../common/constants/dynamo.constants';
import { MessagesRepository, type MessageKey } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { OutboundEventsPublisher } from './outbound-events';
import { OPT_OUT_ERROR_CODE, describeTwilioError, mapTwilioStatus } from './twilio-error.map';

/** What Twilio POSTs to the status callback (urlencoded). */
export interface TwilioStatusBody {
  MessageSid?: string;
  SmsSid?: string;
  MessageStatus?: string;
  SmsStatus?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  AccountSid?: string;
  MessagingServiceSid?: string;
  From?: string;
  To?: string;
}

/** Our own routing parameters, set on every `messages.create` (design §4.5). */
export interface StatusCallbackQuery {
  c?: string;
  t?: string;
  m?: string;
}

export type StatusCallbackOutcome = 'applied' | 'ignored' | 'unknown';

/**
 * `POST /webhooks/twilio/status?c&t&m` (design §4.5): the key comes from
 * the query (signed, so tamper-proof), `PSID#<sid>` is the fallback, and
 * the write is `updateStatus` with the rank + provider-sid guard — so
 * callbacks arriving out of order, twice, or for another sid are no-ops.
 * `ErrorCode 21610` puts the recipient on the STOP list; a terminal status
 * publishes `message.status_changed` for the ticks in the UI.
 */
@Injectable()
export class StatusCallbackService {
  private readonly logger = new Logger(StatusCallbackService.name);

  constructor(
    private readonly messages: MessagesRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly events: OutboundEventsPublisher,
    @Inject(TWILIO_CONFIG) private readonly twilio: Pick<TwilioConfig, 'accountSid' | 'messagingServiceSid'>,
  ) {}

  async handle(query: StatusCallbackQuery, body: TwilioStatusBody): Promise<StatusCallbackOutcome> {
    if (this.twilio.accountSid && body.AccountSid && body.AccountSid !== this.twilio.accountSid) {
      // A foreign account pointed at our URL (or a mis-wired subaccount): not ours to record.
      throw new ForbiddenException('AccountSid does not match this workspace');
    }

    const sid = body.MessageSid || body.SmsSid;
    const status = mapTwilioStatus(body.MessageStatus || body.SmsStatus);
    if (!sid || !status) {
      this.logger.warn(`Status callback without a usable sid/status: ${JSON.stringify(body)}`);
      return 'ignored';
    }

    const key = this.keyFromQuery(query) ?? (await this.keyFromPointer(sid));
    if (!key) {
      this.logger.warn(`Status ${body.MessageStatus} for unknown message ${sid}`);
      return 'unknown';
    }

    const errorCode = body.ErrorCode && body.ErrorCode !== '0' ? String(body.ErrorCode) : undefined;
    const applied = await this.messages.updateStatus(key, {
      status,
      providerSid: sid,
      errorCode,
      errorMessage: errorCode ? describeTwilioError(errorCode, body.ErrorMessage) : undefined,
    });

    if (errorCode === OPT_OUT_ERROR_CODE && body.To) await this.recordOptOut(body.To);

    if (!applied) {
      this.logger.debug(`Status ${status} for ${sid} ignored (out of order or repeated)`);
      return 'ignored';
    }
    if (isTerminalMessageStatus(status)) void this.events.statusChanged(key, status, errorCode);
    void this.events.conversationUpdated(key.conversationId);
    return 'applied';
  }

  private keyFromQuery(query: StatusCallbackQuery): MessageKey | null {
    if (!query.c || !query.t || !query.m) return null;
    return { conversationId: query.c, createdAt: query.t, messageId: query.m };
  }

  private async keyFromPointer(sid: string): Promise<MessageKey | null> {
    const pointer = await this.messages.getProviderSidPointer(sid);
    if (!pointer) return null;
    const { createdAt, messageId } = parseMessageSk(pointer.messageSk);
    return { conversationId: pointer.conversationId, createdAt, messageId };
  }

  private async recordOptOut(address: string): Promise<void> {
    try {
      await this.optOuts.setStatus({
        channel: 'sms',
        address,
        status: 'opted_out',
        source: 'error_21610',
        messagingServiceSid: this.twilio.messagingServiceSid,
      });
      void this.events.optOutChanged({ channel: 'sms', address, status: 'opted_out', source: 'error_21610' });
    } catch (error) {
      this.logger.error(`Could not record opt-out for ${address}: ${error instanceof Error ? error.message : error}`);
    }
  }
}
