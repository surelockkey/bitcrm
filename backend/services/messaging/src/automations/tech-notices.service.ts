import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { type Message } from '@bitcrm/types';
import { type SendCaller, SendService } from '../outbound/send.service';
import { MessagingSettingsService } from '../settings/messaging-settings.service';
import { TemplateRenderer } from '../templates/template-renderer';
import { AutomationsService } from './automations.service';
import { type LateDto } from './dto/late.dto';
import { type OnMyWayDto } from './dto/on-my-way.dto';
import { AutomationPeersClient } from './internal/peers.client';

export type TechNoticeRule = 'on-my-way' | 'late';

/** Two taps inside this window count as one (a double tap, a retried request). */
export const TECH_NOTICE_DEDUP_WINDOW_MS = 15 * 60_000;

/** The rule is switched off (its `AUTOMATION#` row or the settings `*Notify` flag): 422 `AUTOMATION_DISABLED`. */
export class AutomationDisabledException extends HttpException {
  constructor(rule: string) {
    super(`AUTOMATION_DISABLED: ${rule} is switched off in messaging settings`, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

/**
 * The technician's "on my way" / "late" texts to the client (design §10
 * M21; Workiz `tech_message_templates`: `on_my_way_msg`, `late_msg`,
 * `{{first_name}}`, `{{tech_assigned}}`, `{{late_value}}`). Real-time and
 * technician-triggered, so quiet hours do not apply; the opt-out rule and
 * the sender chain do (`SendService.sendSystem`). The caller must be on
 * the job's roster — a dispatcher is not the one on the way.
 */
@Injectable()
export class TechNoticesService {
  private readonly logger = new Logger(TechNoticesService.name);

  constructor(
    private readonly rules: AutomationsService,
    private readonly settings: MessagingSettingsService,
    private readonly peers: AutomationPeersClient,
    private readonly renderer: TemplateRenderer,
    private readonly send: SendService,
  ) {}

  /** `POST /automations/on-my-way`. */
  onMyWay(dto: OnMyWayDto, caller: SendCaller): Promise<Message> {
    return this.notice('on-my-way', dto.dealId, caller, dto.clientMessageId, {
      ...(dto.etaMinutes !== undefined ? { eta_minutes: String(dto.etaMinutes) } : {}),
    });
  }

  /** `POST /automations/late`. */
  late(dto: LateDto, caller: SendCaller): Promise<Message> {
    return this.notice('late', dto.dealId, caller, dto.clientMessageId, { late_value: String(dto.minutes) });
  }

  private async notice(
    rule: TechNoticeRule,
    dealId: string,
    caller: SendCaller,
    clientMessageId: string | undefined,
    values: Record<string, string>,
  ): Promise<Message> {
    const deal = await this.peers.deal(dealId);
    if (!deal) throw new NotFoundException('Job not found');
    if (!deal.assignedTechIds.includes(caller.user.id)) {
      throw new ForbiddenException('Only a technician assigned to the job can send this');
    }

    if (!(await this.rules.isEnabled(rule))) throw new AutomationDisabledException(rule);
    const settings = await this.settings.get();
    const notify = rule === 'on-my-way' ? settings.onMyWayMsgNotify : settings.lateMsgNotify;
    if (notify === false) throw new AutomationDisabledException(rule);
    const template = (rule === 'on-my-way' ? settings.onMyWayMsg : settings.lateMsg)?.trim();
    if (!template) throw new UnprocessableEntityException(`No "${rule}" text is configured in messaging settings`);
    if (!deal.contactId) throw new UnprocessableEntityException('The job has no client contact to text');

    const { conversation } = await this.send.conversationForContact(deal.contactId);
    const rendered = await this.renderer.render(
      { body: template, format: 'text' },
      { conversationId: conversation.id, contactId: deal.contactId, dealId, userId: caller.user.id, values },
    );
    const body = rendered.body.trim();
    if (!body) throw new UnprocessableEntityException(`The "${rule}" text rendered empty`);

    const bucket = Math.floor(Date.now() / TECH_NOTICE_DEDUP_WINDOW_MS);
    const { message, duplicate } = await this.send.sendSystem({
      conversation,
      body,
      dealId,
      origin: 'automation',
      automationRuleId: rule,
      sentByUserId: caller.user.id,
      clientMessageId: clientMessageId ?? `automation:${rule}:${dealId}:${caller.user.id}:${bucket}`,
      actorId: caller.user.id,
    });
    this.logger.log(`${rule} for job ${dealId} by ${caller.user.id}: ${duplicate ? 'duplicate' : message.id}`);
    return message;
  }
}
