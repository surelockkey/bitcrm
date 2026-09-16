import { Injectable, Logger } from '@nestjs/common';
import { JobSuperStatus } from '@bitcrm/types';
import { RecipientOptedOutException, SendService } from '../outbound/send.service';
import { MessagingSettingsService } from '../settings/messaging-settings.service';
import { TemplateRenderer } from '../templates/template-renderer';
import { AUTOMATIONS_ACTOR } from './automations.constants';
import { AutomationsService } from './automations.service';
import { AutoSentRepository } from './auto-sent.repository';
import { isDealTechAssignedPayload, isDealUpdatedPayload } from './deal-events';
import { AutomationPeersClient, type AutomationDeal } from './internal/peers.client';
import { isWithinQuietHours } from './quiet-hours';
import { TeamThreadService } from './team-thread.service';

export const NEW_JOB_SMS_RULE_ID = 'new-job-sms' as const;

/** Jobs nobody should be dispatched to any more. */
const CLOSED: ReadonlyArray<string> = [JobSuperStatus.CANCELED, JobSuperStatus.DONE];

/** Why a technician was not texted — logged, and what the unit tests assert on. */
export type NewJobSmsOutcome =
  | 'sent'
  | 'duplicate'
  | 'already_notified'
  | 'not_on_roster'
  | 'no_phone'
  | 'inactive_user'
  | 'opted_out'
  | 'blank_text';

export type NewJobSmsSkip = 'disabled' | 'no_template' | 'no_deal' | 'closed_deal' | 'quiet_hours';

/**
 * The Workiz "New job #…" dispatch text (design §6, §10 M21; Workiz
 * `sms_format`, 324 k messages in technician threads): when a technician
 * is put on a job, the settings `smsFormat` template is rendered for that
 * job and technician and sent to their personal phone in their team
 * thread. A reschedule (`deal.updated` with a different `scheduledDate`
 * than the one they were told) sends it again; any other edit does not.
 *
 * Once per (job, technician, scheduledDate): `AUTOSENT#` marker + the
 * deterministic `clientMessageId`. Held during the settings quiet hours
 * (skipped and logged — there is no scheduler to release it yet), skipped
 * for opted-out numbers, phone-less or inactive users and closed jobs.
 * Everything here is best-effort per technician: one failure to read a
 * peer does not block the others, and nothing throws back to SQS except a
 * table error.
 */
@Injectable()
export class NewJobSmsService {
  private readonly logger = new Logger(NewJobSmsService.name);

  constructor(
    private readonly rules: AutomationsService,
    private readonly settings: MessagingSettingsService,
    private readonly peers: AutomationPeersClient,
    private readonly threads: TeamThreadService,
    private readonly renderer: TemplateRenderer,
    private readonly send: SendService,
    private readonly markers: AutoSentRepository,
  ) {}

  /** `deal.tech_assigned` — one technician joined the roster. */
  async onTechAssigned(payload: unknown): Promise<void> {
    if (!isDealTechAssignedPayload(payload)) {
      this.logger.warn(`Dropping malformed deal.tech_assigned payload: ${JSON.stringify(payload)}`);
      return;
    }
    await this.notify(payload.dealId, [payload.techId], 'assigned');
  }

  /** `deal.updated` — re-notify only the technicians already told about a different date. */
  async onDealUpdated(payload: unknown): Promise<void> {
    if (!isDealUpdatedPayload(payload)) {
      this.logger.warn(`Dropping malformed deal.updated payload: ${JSON.stringify(payload)}`);
      return;
    }
    await this.notify(payload.dealId, undefined, 'rescheduled');
  }

  /**
   * `techIds` absent = "whoever on the roster already has a marker with a
   * different date" (the reschedule case); given = the newly assigned.
   */
  async notify(
    dealId: string,
    techIds: string[] | undefined,
    reason: 'assigned' | 'rescheduled',
  ): Promise<NewJobSmsSkip | Record<string, NewJobSmsOutcome>> {
    if (!(await this.rules.isEnabled(NEW_JOB_SMS_RULE_ID))) return 'disabled';

    const settings = await this.settings.get();
    const template = settings.smsFormat?.trim();
    if (!template) {
      this.logger.warn(`New-job SMS for ${dealId} skipped: settings.smsFormat is empty`);
      return 'no_template';
    }

    const deal = await this.peers.deal(dealId);
    if (!deal) {
      this.logger.warn(`New-job SMS for ${dealId} skipped: job not readable`);
      return 'no_deal';
    }
    if (deal.superStatus && CLOSED.includes(deal.superStatus)) return 'closed_deal';

    if (isWithinQuietHours(settings.quietHours)) {
      this.logger.log(`New-job SMS for ${dealId} (${reason}) held: inside quiet hours`);
      return 'quiet_hours';
    }

    const scheduledDate = deal.scheduledDate ?? '';
    const outcomes: Record<string, NewJobSmsOutcome> = {};
    for (const techId of techIds ?? deal.assignedTechIds) {
      outcomes[techId] = await this.notifyOne(deal, techId, scheduledDate, template, reason);
      this.logger.log(`New-job SMS ${deal.id} → tech ${techId} (${reason}): ${outcomes[techId]}`);
    }
    return outcomes;
  }

  private async notifyOne(
    deal: AutomationDeal,
    techId: string,
    scheduledDate: string,
    template: string,
    reason: 'assigned' | 'rescheduled',
  ): Promise<NewJobSmsOutcome> {
    if (!deal.assignedTechIds.includes(techId)) return 'not_on_roster';

    const marker = await this.markers.get(deal.id, NEW_JOB_SMS_RULE_ID, techId);
    if (marker && marker.scheduledDate === scheduledDate) return 'already_notified';
    // A reschedule only re-tells technicians who were told before; a tech
    // assigned before this automation existed is not surprised by a notes edit.
    if (reason === 'rescheduled' && !marker) return 'already_notified';

    const user = await this.peers.user(techId);
    if (!user) return 'no_phone';
    if (user.status && user.status !== 'active') return 'inactive_user';
    if (!user.phone) return 'no_phone';

    const rendered = await this.renderer.render({ body: template, format: 'text' }, { dealId: deal.id, userId: techId });
    const body = rendered.body.trim();
    if (!body) return 'blank_text';

    const thread = await this.threads.forTechnician(user);
    let outcome: NewJobSmsOutcome;
    let sent: { conversationId: string; messageId: string; sentAt: string };
    try {
      const result = await this.send.sendSystem({
        conversation: thread,
        body,
        to: user.phone,
        dealId: deal.id,
        origin: 'automation',
        automationRuleId: NEW_JOB_SMS_RULE_ID,
        clientMessageId: `automation:${NEW_JOB_SMS_RULE_ID}:${deal.id}:${techId}:${scheduledDate || 'unscheduled'}`,
        actorId: AUTOMATIONS_ACTOR,
      });
      outcome = result.duplicate ? 'duplicate' : 'sent';
      sent = { conversationId: result.message.conversationId, messageId: result.message.id, sentAt: result.message.createdAt };
    } catch (error) {
      if (error instanceof RecipientOptedOutException) return 'opted_out';
      throw error;
    }

    await this.markers.put({
      dealId: deal.id,
      ruleId: NEW_JOB_SMS_RULE_ID,
      techId,
      scheduledDate,
      conversationId: sent.conversationId,
      messageId: sent.messageId,
      sentAt: sent.sentAt,
    });
    return outcome;
  }
}
