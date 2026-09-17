import { HttpException, HttpStatus, Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { type Conversation, type DealSentToTechEvent, type SendToTechChannel } from '@bitcrm/types';
import { RecipientOptedOutException, SendService } from '../outbound/send.service';
import { MessagingSettingsService } from '../settings/messaging-settings.service';
import { TemplateRenderer } from '../templates/template-renderer';
import { AUTOMATIONS_ACTOR } from './automations.constants';
import { AutoSentRepository } from './auto-sent.repository';
import { isDealSentToTechPayload } from './deal-events';
import {
  AutomationPeersClient,
  type AutomationDeal,
  type AutomationUser,
  type SentToTechReport,
} from './internal/peers.client';
import { TeamThreadService } from './team-thread.service';

/** `AUTOSENT#` rule id per channel — one marker per (job, technician, channel). */
export const sendToTechRuleId = (channel: SendToTechChannel) => `send-to-tech:${channel}` as const;

/** `CLIENTMSG#` key: the click's `sentAt` makes a resend a new message, a redelivery a duplicate. */
export const sendToTechMessageKey = (dealId: string, techId: string, channel: SendToTechChannel, sentAt: string) =>
  `send-to-tech:${dealId}:${techId}:${channel}:${sentAt}`;

/** What became of one (technician, channel) — logged, reported back, and what the unit tests assert on. */
export type SendToTechOutcome =
  | 'sent'
  | 'duplicate'
  | 'not_on_roster'
  | 'no_user'
  | 'inactive_user'
  | 'no_phone'
  | 'no_email'
  | 'email_not_configured'
  | 'opted_out'
  | 'blank_text'
  /** The send was refused for good (a 4xx) — reported `failed`, with the refusal as the reason. */
  | 'failed';

/** Nothing was attempted for the whole event. */
export type SendToTechSkip = 'malformed' | 'no_template' | 'no_deal';

/** Per technician, per channel. */
export type SendToTechOutcomes = Record<string, Partial<Record<SendToTechChannel, SendToTechOutcome>>>;

/** Only these two count as delivered; everything else is a `skipped` (or, for `failed`, a `failed`) report. */
const DELIVERED: ReadonlyArray<SendToTechOutcome> = ['sent', 'duplicate'];

/** A report's `reason` is one line on the job page — never a stack trace. */
const MAX_REASON = 200;

/**
 * Is this error a permanent "no", or worth another delivery of the event?
 *
 * A 4xx out of the send path is the caller's fault and will answer the same
 * on every redelivery — a `User.phone` stored unnormalised so it does not
 * match the team thread's number, an address the conversation does not
 * carry. Rethrowing one of those costs every technician after it in the loop
 * their message until the event reaches the DLQ, and re-POSTs deal-service
 * the same reports each pass. 408 / 429 are the two 4xx that do clear up, so
 * they keep the retry; 5xx (the table, the queue, `NotImplementedException`)
 * always do.
 */
function isPermanentSendFailure(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return (
    status >= 400 &&
    status < 500 &&
    status !== HttpStatus.REQUEST_TIMEOUT &&
    status !== HttpStatus.TOO_MANY_REQUESTS
  );
}

/**
 * Workiz "Send to tech" (design §6, §10 M21; `WORKIZ_FEATURE_GAPS` §2.1 /
 * §2.5 — 255 993 jobs with `sent`, ≈455 k "Sent to tech" events): a
 * dispatcher pressed the button, deal-service stamped the job and published
 * `deal.sent_to_tech`, and this consumer hands the job to each technician
 * over each channel the dispatcher ticked:
 *
 *   sms     the settings `smsFormat` text to their personal phone, in their team thread
 *   in_app  the same text as a line in that thread (the mobile app's notification)
 *   email   the same text to their work email, subject "New job #…" — skipped
 *           with `email_not_configured` until `MESSAGING_EMAIL_FROM` is set
 *
 * Idempotent per (job, technician, channel, click): the `AUTOSENT#` marker
 * carries the click's `sentAt` and the send itself is keyed
 * `send-to-tech:<deal>:<tech>:<channel>:<sentAt>`, so an SQS redelivery
 * sends nothing twice while a second press of the button (a new `sentAt`)
 * sends again. Quiet hours do **not** hold it — a dispatcher asking for the
 * job to go out now is not a background automation.
 *
 * Every outcome is reported back with `PUT /deals/internal/:id/sent-to-tech`,
 * including the ones where nothing about the job could be read or rendered.
 * One channel failing never stops the others: a refusal that redelivery
 * cannot fix (any 4xx — an unnormalised `User.phone`, an address the thread
 * does not carry) is reported `failed` with the refusal as its reason and
 * the loop carries on, so one bad recipient costs one line rather than every
 * technician after them. Only a transient error (the table, the queue, a 5xx)
 * is rethrown, and then SQS redelivers onto the markers of what already went.
 */
@Injectable()
export class SendToTechService {
  private readonly logger = new Logger(SendToTechService.name);

  constructor(
    private readonly settings: MessagingSettingsService,
    private readonly peers: AutomationPeersClient,
    private readonly threads: TeamThreadService,
    private readonly renderer: TemplateRenderer,
    private readonly send: SendService,
    private readonly markers: AutoSentRepository,
  ) {}

  /** `deal.sent_to_tech` off the `deal-events-to-messaging` queue. */
  async onSentToTech(payload: unknown): Promise<SendToTechSkip | SendToTechOutcomes> {
    if (!isDealSentToTechPayload(payload)) {
      this.logger.warn(`Dropping malformed deal.sent_to_tech payload: ${JSON.stringify(payload)}`);
      return 'malformed';
    }
    return this.deliver(payload);
  }

  async deliver(event: DealSentToTechEvent): Promise<SendToTechSkip | SendToTechOutcomes> {
    const settings = await this.settings.get();
    const template = settings.smsFormat?.trim();
    if (!template) {
      this.logger.warn(`Send to tech for ${event.dealId} skipped: settings.smsFormat is empty`);
      await this.reportAll(event, 'skipped', 'no_template');
      return 'no_template';
    }

    const deal = await this.peers.deal(event.dealId);
    if (!deal) {
      this.logger.warn(`Send to tech for ${event.dealId} skipped: job not readable`);
      // Say so on every (technician, channel), like the no-template branch: a
      // delivery row that is never written leaves the card on "SMS · sending…"
      // for good, which reads as "still on its way" rather than "nothing went".
      await this.reportAll(event, 'failed', 'no_deal');
      return 'no_deal';
    }

    const channels = [...new Set(event.channels)];
    const outcomes: SendToTechOutcomes = {};
    for (const techId of [...new Set(event.techIds)]) {
      outcomes[techId] = await this.deliverToTech(event, deal, techId, channels, template);
    }
    return outcomes;
  }

  /** Everything one technician gets: the text is rendered once, then delivered per channel. */
  private async deliverToTech(
    event: DealSentToTechEvent,
    deal: AutomationDeal,
    techId: string,
    channels: SendToTechChannel[],
    template: string,
  ): Promise<Partial<Record<SendToTechChannel, SendToTechOutcome>>> {
    const result: Partial<Record<SendToTechChannel, SendToTechOutcome>> = {};

    const stop = async (outcome: SendToTechOutcome) => {
      for (const channel of channels) {
        result[channel] = outcome;
        await this.report(event, techId, channel, outcome);
        this.logger.log(`Send to tech ${deal.id} → ${techId} (${channel}): ${outcome}`);
      }
      return result;
    };

    // The roster is re-read now, not trusted from the event: a technician
    // taken off the job between the click and this handler is not told.
    if (!deal.assignedTechIds.includes(techId)) return stop('not_on_roster');
    const user = await this.peers.user(techId);
    if (!user) return stop('no_user');
    if (user.status && user.status !== 'active') return stop('inactive_user');

    const rendered = await this.renderer.render({ body: template, format: 'text' }, { dealId: deal.id, userId: techId });
    const body = rendered.body.trim();
    if (!body) return stop('blank_text');

    const thread = await this.threads.forTechnician(user);
    for (const channel of channels) {
      const outcome = await this.deliverChannel(event, deal, user, thread, channel, body);
      result[channel] = outcome;
      this.logger.log(`Send to tech ${deal.id} → ${techId} (${channel}): ${outcome}`);
    }
    return result;
  }

  private async deliverChannel(
    event: DealSentToTechEvent,
    deal: AutomationDeal,
    user: AutomationUser,
    conversation: Conversation,
    channel: SendToTechChannel,
    body: string,
  ): Promise<SendToTechOutcome> {
    const ruleId = sendToTechRuleId(channel);
    const marker = await this.markers.get(deal.id, ruleId, user.id);
    if (marker?.sentFor === event.sentAt) {
      await this.report(event, user.id, channel, 'duplicate', { messageId: marker.messageId, conversationId: marker.conversationId });
      return 'duplicate';
    }

    if (channel === 'sms' && !user.phone) return this.skip(event, user.id, channel, 'no_phone');
    if (channel === 'email' && !user.email) return this.skip(event, user.id, channel, 'no_email');

    let outcome: SendToTechOutcome;
    let sent: { conversationId: string; messageId: string; createdAt: string };
    try {
      const result = await this.send.sendSystem({
        conversation,
        channel,
        body,
        ...(channel === 'sms' ? { to: user.phone } : {}),
        ...(channel === 'email' ? { to: user.email, subject: emailSubject(event, deal) } : {}),
        dealId: deal.id,
        origin: 'automation',
        automationRuleId: ruleId,
        sentByUserId: event.sentBy,
        clientMessageId: sendToTechMessageKey(deal.id, user.id, channel, event.sentAt),
        actorId: AUTOMATIONS_ACTOR,
      });
      outcome = result.duplicate ? 'duplicate' : 'sent';
      sent = {
        conversationId: result.message.conversationId,
        messageId: result.message.id,
        createdAt: result.message.createdAt,
      };
    } catch (error) {
      if (error instanceof RecipientOptedOutException) return this.skip(event, user.id, channel, 'opted_out');
      if (error instanceof NotImplementedException && channel === 'email') {
        return this.skip(event, user.id, channel, 'email_not_configured');
      }
      // One bad recipient is one bad channel, not the end of the click: report
      // it and let the rest of this technician's channels — and every
      // technician after them — still go out.
      if (isPermanentSendFailure(error)) return this.fail(event, user.id, channel, error);
      throw error;
    }

    await this.markers.put({
      dealId: deal.id,
      ruleId,
      techId: user.id,
      scheduledDate: deal.scheduledDate ?? '',
      sentFor: event.sentAt,
      conversationId: sent.conversationId,
      messageId: sent.messageId,
      sentAt: sent.createdAt,
    });
    await this.report(event, user.id, channel, outcome, { messageId: sent.messageId, conversationId: sent.conversationId });
    return outcome;
  }

  private async skip(
    event: DealSentToTechEvent,
    techId: string,
    channel: SendToTechChannel,
    outcome: SendToTechOutcome,
  ): Promise<SendToTechOutcome> {
    await this.report(event, techId, channel, outcome);
    return outcome;
  }

  /** A channel refused for good: reported `failed`, with the refusal in the dispatcher's words. */
  private async fail(
    event: DealSentToTechEvent,
    techId: string,
    channel: SendToTechChannel,
    error: HttpException,
  ): Promise<SendToTechOutcome> {
    const reason = (error.message || 'send refused').slice(0, MAX_REASON);
    this.logger.error(`Send to tech ${event.dealId} → ${techId} (${channel}) failed: ${reason}`);
    await this.report(event, techId, channel, 'failed', { reason });
    return 'failed';
  }

  private report(
    event: DealSentToTechEvent,
    techId: string,
    channel: SendToTechChannel,
    outcome: SendToTechOutcome,
    ids: { messageId?: string; conversationId?: string; reason?: string } = {},
  ): Promise<boolean> {
    const delivered = DELIVERED.includes(outcome);
    const report: SentToTechReport = {
      techId,
      channel,
      status: delivered ? 'sent' : outcome === 'failed' ? 'failed' : 'skipped',
      sentAt: event.sentAt,
      ...(delivered ? {} : { reason: ids.reason ?? outcome }),
      ...(ids.messageId ? { messageId: ids.messageId } : {}),
      ...(ids.conversationId ? { conversationId: ids.conversationId } : {}),
      at: new Date().toISOString(),
    };
    return this.peers.reportSentToTech(event.dealId, report);
  }

  /** One reason for every (technician, channel) — nothing about the job could be rendered. */
  private async reportAll(
    event: DealSentToTechEvent,
    status: 'skipped' | 'failed',
    reason: string,
  ): Promise<void> {
    for (const techId of [...new Set(event.techIds)]) {
      for (const channel of [...new Set(event.channels)]) {
        await this.peers.reportSentToTech(event.dealId, {
          techId,
          channel,
          status,
          sentAt: event.sentAt,
          reason,
          at: new Date().toISOString(),
        });
      }
    }
  }
}

/**
 * Workiz titles the mail after the first line of the "New job" text; the
 * job number is what a technician scans for, so it is the subject here —
 * the rendered text is the body.
 */
export function emailSubject(event: DealSentToTechEvent, deal: AutomationDeal): string {
  const number = event.dealNumber ?? deal.dealNumber;
  return number ? `New job #${number}` : 'New job';
}
