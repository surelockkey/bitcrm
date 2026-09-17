import { Injectable, Logger } from '@nestjs/common';
import { type Conversation, type Message, type PushDevice, type PushNotificationData } from '@bitcrm/types';
import { SEND_TO_TECH_RULE_PREFIX } from '../automations/automations.constants';
import { isWithinQuietHours } from '../automations/quiet-hours';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { MessagingSettingsService } from '../settings/messaging-settings.service';
import { resolveTimezone } from '../templates/date-format';
import { ExpoPushService, type ExpoPushMessage } from './expo-push.service';
import { PushDevicesRepository } from './push-devices.repository';
import { type JobPushDeal, jobPushBody, jobPushTitle, messagePushBody, messagePushTitle } from './push-text';

/** What a caller hands over about the job that was sent. */
export interface JobPushInput {
  dealId: string;
  techId: string;
  deal: JobPushDeal;
}

/** Why nothing was pushed — logged, and what the unit tests assert on. */
export type PushSkip =
  | 'disabled'
  | 'no_device'
  | 'no_recipients'
  | 'quiet_hours'
  | 'opted_out'
  | 'own_message'
  | 'already_pushed'
  | 'failed';

/**
 * Who gets a push, and what it says (design §6, §10 M21; the two events
 * `WORKIZ_MOBILE_APP.md` §1.14 names as the app's whole notification story:
 * a new job, and a new message).
 *
 * Two entry points, both fire-and-forget: a push is a courtesy on top of a
 * write that already succeeded, so nothing here may fail the send, the
 * `deal.sent_to_tech` delivery, or the SQS message that carried it. Every
 * path returns why it did nothing instead of throwing.
 *
 * What it respects, because the service already knows it:
 *
 *   own message   a person is never pushed their own line — the recipient
 *                 list excludes the author, and it is re-checked here.
 *   quiet hours   held for a **message**: a chat line is not worth a lit
 *                 screen at 2 a.m. NOT held for a **job**: a dispatcher
 *                 pressing "Send to tech" is asking for it to go out now,
 *                 which is exactly the rule `SendToTechService` already
 *                 documents for the SMS.
 *   opt-outs      a 1:1 employee thread carries the person's own number, and
 *                 a STOP on it is that person saying "stop lighting up my
 *                 phone". A group has no address to check.
 *   one push      the in-app line "Send to tech" writes already gets the job
 *                 push, so the message path skips `send-to-tech:*` lines
 *                 rather than buzzing the same phone twice about one click.
 */
@Injectable()
export class PushNotifierService {
  private readonly logger = new Logger(PushNotifierService.name);

  constructor(
    private readonly expo: ExpoPushService,
    private readonly devices: PushDevicesRepository,
    private readonly settings: MessagingSettingsService,
    private readonly optOuts: OptOutsRepository,
  ) {}

  /**
   * A job was handed to a technician. Called after the in-app channel of
   * "Send to tech" actually delivered — the channel the dispatcher ticks for
   * the app, and in Workiz's own numbers a separate choice from SMS
   * (`Sent to tech by In App` 120 571 vs `by SMS` 316 331), so a technician
   * sent the job by text alone is not also pushed.
   */
  async notifyJobSentToTech(input: JobPushInput): Promise<PushSkip | number> {
    if (!this.expo.enabled) return this.disabled('job');
    try {
      const devices = await this.devices.listByUser(input.techId);
      if (!devices.length) return 'no_device';

      const settings = await this.settings.get();
      const timezone = resolveTimezone(settings.timezone);
      const data: PushNotificationData = { kind: 'job', dealId: input.dealId };
      const sent = await this.push(devices, jobPushTitle(input.deal), jobPushBody(input.deal, timezone), data);
      this.logger.log(`Job push for ${input.dealId} → ${input.techId}: ${sent} device(s)`);
      return sent;
    } catch (error) {
      return this.swallow(`job push for ${input.dealId}`, error);
    }
  }

  /**
   * A new message somebody should see. `recipientIds` is the list the caller
   * already computed for the line (`teamRecipients`) — the group roster or
   * the employee whose thread it is, minus its author. A client thread has
   * no members, so nothing here fires for one: the office watches the web
   * inbox over SSE.
   */
  async notifyNewMessage(
    message: Message,
    conversation: Conversation,
    recipientIds: readonly string[],
  ): Promise<PushSkip | number> {
    if (!this.expo.enabled) return this.disabled('message');
    // The in-app line of "Send to tech" is the job, and the job push already
    // went out for it — one click, one buzz.
    if (message.automationRuleId?.startsWith(SEND_TO_TECH_RULE_PREFIX)) return 'already_pushed';

    const recipients = [...new Set(recipientIds)].filter((id) => id && id !== message.sentByUserId);
    if (!recipients.length) return recipientIds.length ? 'own_message' : 'no_recipients';

    try {
      const settings = await this.settings.get();
      if (isWithinQuietHours(settings.quietHours)) {
        this.logger.log(`Message push for ${conversation.id} held: quiet hours`);
        return 'quiet_hours';
      }
      if (await this.threadOptedOut(conversation)) return 'opted_out';

      const devices = await this.devices.listByUsers(recipients);
      if (!devices.length) return 'no_device';

      const data: PushNotificationData = {
        kind: 'conversation',
        conversationId: message.conversationId,
        messageId: message.id,
      };
      const sent = await this.push(
        devices,
        messagePushTitle(message, conversation),
        messagePushBody(message, conversation),
        data,
      );
      this.logger.log(`Message push for ${conversation.id} → ${recipients.length} user(s): ${sent} device(s)`);
      return sent;
    } catch (error) {
      return this.swallow(`message push for ${conversation.id}`, error);
    }
  }

  /** One notification per device; the transport batches and reports. */
  private async push(
    devices: PushDevice[],
    title: string,
    body: string,
    data: PushNotificationData,
  ): Promise<number> {
    const messages: ExpoPushMessage[] = devices.map((device) => ({
      to: device.token,
      title,
      body,
      data,
      sound: 'default',
      // Both of these are something a person is waiting on in the field —
      // a job to drive to, an answer from the office.
      priority: 'high',
    }));
    const result = await this.expo.send(messages);
    return result.accepted;
  }

  /**
   * A STOP on the thread's own number. Only a 1:1 employee thread has one
   * (it is that person's personal phone, the same number their SMS arrives
   * from); a group is a roster, not an address.
   */
  private async threadOptedOut(conversation: Conversation): Promise<boolean> {
    if (conversation.kind !== 'team') return false;
    for (const phone of conversation.addresses?.phones ?? []) {
      if (await this.optOuts.isOptedOut('sms', phone)) {
        this.logger.log(`Message push for ${conversation.id} held: the thread's number has opted out`);
        return true;
      }
    }
    return false;
  }

  /** The single line the flag promises, at the one place each caller enters. */
  private disabled(what: string): PushSkip {
    this.logger.log(`Push is disabled (PUSH_ENABLED): no ${what} notification sent`);
    return 'disabled';
  }

  /** A push must never take down the write that produced it. */
  private swallow(what: string, error: unknown): PushSkip {
    this.logger.warn(`${what} failed: ${error instanceof Error ? error.message : error}`);
    return 'failed';
  }
}
