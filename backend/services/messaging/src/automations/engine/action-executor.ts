import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type AutomationAction, type AutomationRunAction } from '@bitcrm/types';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';
import { RecipientOptedOutException, SendService } from '../../outbound/send.service';
import { TemplateRenderer } from '../../templates/template-renderer';
import { AUTOMATIONS_ACTOR } from '../automations.constants';
import { AutomationPeersClient, type AutomationUser } from '../internal/peers.client';
import { TeamThreadService } from '../team-thread.service';
import { type AutomationFacts } from './facts';
import { sha1, type AutomationEvent } from './trigger-event';

/** Everything an action needs besides the action itself. */
export interface ActionContext {
  ruleId: string;
  event: AutomationEvent;
  facts: AutomationFacts;
  /** `deal:<id>` / `call:<sid>` / `message:<id>`. */
  entity: string;
  occurrence: string;
  /** Position in `spec.actions` — part of the idempotency key, so two identical actions both send. */
  index: number;
  /** A test run renders and resolves recipients but sends nothing. */
  dryRun?: boolean;
  /** Extra short-code values (a test run's sample data). */
  values?: Record<string, string>;
}

/** One resolved destination of a `send_*` action. */
interface Recipient {
  /** Stable per-recipient half of the idempotency key. */
  key: string;
  label: string;
  contactId?: string;
  user?: AutomationUser;
  phone?: string;
}

const HTTP_TIMEOUT_MS = 8_000;

/**
 * The "what it does" half of the rule engine. Every action answers with an
 * `AutomationRunAction` — what was attempted, to whom, and how it went —
 * which is what the firing log stores and the test-run dialog shows.
 *
 * Deliberate limits of this milestone, reported honestly rather than
 * failing silently (outcome `unsupported`):
 *
 *   send_email / send_in_app  the system send path is SMS-only
 *                             (`SendService.sendSystem`); an email or in-app
 *                             automation needs the email worker and a team
 *                             thread author, which the outbound module does
 *                             not expose to a caller-less sender yet.
 *   add_tag / change_sub_status  deal-service has no internal write endpoint
 *                             for either; the action is typed, translated
 *                             and editable, and starts working the day the
 *                             endpoint lands.
 *
 * Nothing here throws for a single bad recipient: a rule with three
 * technicians texts the two it can reach and records why the third was
 * skipped.
 */
@Injectable()
export class AutomationActionExecutor {
  private readonly logger = new Logger(AutomationActionExecutor.name);

  constructor(
    private readonly peers: AutomationPeersClient,
    private readonly threads: TeamThreadService,
    private readonly renderer: TemplateRenderer,
    private readonly send: SendService,
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async run(action: AutomationAction, ctx: ActionContext): Promise<AutomationRunAction[]> {
    switch (action.type) {
      case 'send_sms':
        return this.sendSms(action, ctx);
      case 'webhook':
        return [await this.webhook(action, ctx)];
      case 'send_email':
      case 'send_in_app':
        return [
          {
            type: action.type,
            to: action.to,
            outcome: 'unsupported',
            error: `${action.type} is not sent by the engine yet (SMS only)`,
          },
        ];
      case 'add_tag':
      case 'change_sub_status':
        return [
          {
            type: action.type,
            outcome: 'unsupported',
            error: 'deal-service has no internal endpoint for this write yet',
          },
        ];
      default:
        return [{ type: action.type, outcome: 'unsupported', error: `unknown action ${String(action.type)}` }];
    }
  }

  // ---------------------------------------------------------------- send_sms

  private async sendSms(action: AutomationAction, ctx: ActionContext): Promise<AutomationRunAction[]> {
    const recipients = await this.recipients(action, ctx);
    if (!recipients.length) {
      return [{ type: action.type, to: action.to, outcome: 'skipped', error: 'no recipient resolved' }];
    }

    const out: AutomationRunAction[] = [];
    for (const recipient of recipients) {
      out.push(await this.smsTo(action, ctx, recipient));
    }
    return out;
  }

  private async smsTo(
    action: AutomationAction,
    ctx: ActionContext,
    recipient: Recipient,
  ): Promise<AutomationRunAction> {
    const base: AutomationRunAction = { type: action.type, to: recipient.label, outcome: 'skipped' };
    try {
      const conversation = recipient.user
        ? await this.threads.forTechnician(recipient.user)
        : recipient.contactId
          ? (await this.send.conversationForContact(recipient.contactId)).conversation
          : recipient.phone
            ? (await this.send.conversationForParty({ phone: recipient.phone })).conversation
            : undefined;
      if (!conversation) return { ...base, error: 'no conversation for the recipient' };

      const to = recipient.user?.phone ?? recipient.phone;
      if (recipient.user && !to) return { ...base, error: 'the employee has no personal phone' };

      const rendered = await this.renderer.render(
        {
          ...(action.templateId ? { templateId: action.templateId } : {}),
          ...(action.body ? { body: action.body } : {}),
          format: 'text',
        },
        {
          conversationId: conversation.id,
          contactId: recipient.contactId ?? ctx.facts.deal?.contactId,
          dealId: ctx.facts.deal?.id,
          userId: recipient.user?.id,
          values: ctx.values,
        },
      );
      const body = rendered.body.trim();
      if (!body) return { ...base, error: 'the text rendered empty' };
      if (ctx.dryRun) return { ...base, outcome: 'dry_run', body, conversationId: conversation.id };

      const result = await this.send.sendSystem({
        conversation,
        body,
        ...(to ? { to } : {}),
        dealId: ctx.facts.deal?.id,
        origin: 'automation',
        automationRuleId: ctx.ruleId,
        templateId: action.templateId,
        clientMessageId: this.clientMessageId(ctx, recipient),
        actorId: AUTOMATIONS_ACTOR,
      });
      return {
        ...base,
        outcome: result.duplicate ? 'duplicate' : 'sent',
        body,
        messageId: result.message.id,
        conversationId: result.message.conversationId,
      };
    } catch (error) {
      if (error instanceof RecipientOptedOutException) return { ...base, outcome: 'skipped', error: 'opted out' };
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rule ${ctx.ruleId} could not text ${recipient.label}: ${message}`);
      return { ...base, outcome: 'failed', error: message };
    }
  }

  /** `automation:<rule>:<entity>:<occurrence hash>:<action>:<recipient>` — replay-proof and bounded. */
  private clientMessageId(ctx: ActionContext, recipient: Recipient): string {
    return `automation:${ctx.ruleId}:${ctx.entity}:${sha1(ctx.occurrence).slice(0, 16)}:${ctx.index}:${recipient.key}`;
  }

  // -------------------------------------------------------------- recipients

  private async recipients(action: AutomationAction, ctx: ActionContext): Promise<Recipient[]> {
    const deal = ctx.facts.deal;
    switch (action.to ?? 'client') {
      case 'client': {
        const contactId = deal?.contactId ?? ctx.facts.message?.partyId ?? ctx.facts.call?.contactId;
        return contactId ? [{ key: `contact:${contactId}`, label: 'client', contactId }] : [];
      }
      case 'assigned_techs':
        return this.users(deal?.assignedTechIds ?? [], 'tech');
      case 'dispatcher':
        return this.users(deal?.assignedDispatcherId ? [deal.assignedDispatcherId] : [], 'dispatcher');
      case 'users':
        return this.users(action.userIds ?? [], 'user');
      case 'role': {
        const ids: string[] = [];
        for (const roleId of action.roleIds ?? []) ids.push(...(await this.peers.userIdsByRole(roleId)));
        return this.users([...new Set(ids)], 'user');
      }
      case 'number':
        return action.number ? [{ key: `num:${action.number}`, label: action.number, phone: action.number }] : [];
      default:
        return [];
    }
  }

  private async users(ids: string[], label: string): Promise<Recipient[]> {
    const out: Recipient[] = [];
    for (const id of ids) {
      const user = await this.peers.user(id);
      if (!user) {
        this.logger.warn(`Automation recipient ${label} ${id} is not readable — skipped`);
        continue;
      }
      if (user.status && user.status !== 'active') continue;
      out.push({ key: `user:${id}`, label: `${label} ${user.firstName ?? id}`.trim(), user });
    }
    return out;
  }

  // ----------------------------------------------------------------- webhook

  private async webhook(action: AutomationAction, ctx: ActionContext): Promise<AutomationRunAction> {
    const base: AutomationRunAction = { type: 'webhook', to: action.url, outcome: 'skipped' };
    if (!action.url) return { ...base, error: 'no url' };

    const payload = action.payload
      ? (
          await this.renderer.render(
            { body: action.payload, format: 'text', keepMissing: false },
            { dealId: ctx.facts.deal?.id, contactId: ctx.facts.deal?.contactId, values: ctx.values },
          )
        ).body
      : JSON.stringify({
          event: ctx.event.kind,
          firedAt: ctx.event.at,
          ruleId: ctx.ruleId,
          deal: ctx.facts.deal,
          call: ctx.facts.call,
          message: ctx.facts.message,
        });

    if (ctx.dryRun) return { ...base, outcome: 'dry_run', body: payload };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(action.url, {
        method: action.method ?? 'POST',
        headers: { 'Content-Type': 'application/json', ...(action.headers ?? {}) },
        body: payload,
        signal: controller.signal,
      } as RequestInit);
      return {
        ...base,
        outcome: res.ok ? 'sent' : 'failed',
        statusCode: res.status,
        body: payload,
        ...(res.ok ? {} : { error: `webhook answered ${res.status}` }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...base, outcome: 'failed', error: message, body: payload };
    } finally {
      clearTimeout(timer);
    }
  }
}
