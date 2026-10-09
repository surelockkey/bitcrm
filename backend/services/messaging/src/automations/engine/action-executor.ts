import { Inject, Injectable, Logger, NotImplementedException, Optional } from '@nestjs/common';
import { tryNormalizePhone } from '@bitcrm/shared';
import { type AutomationAction, type AutomationRunAction, type Conversation } from '@bitcrm/types';
import { ConversationsRepository } from '../../conversations/conversations.repository';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from '../../outbound/internal/internal-fetch';
import { RecipientOptedOutException, SendService } from '../../outbound/send.service';
import { looksLikeHtml } from '../../templates/html-text';
import { type RenderRefs } from '../../templates/render-context';
import { TemplateRenderer } from '../../templates/template-renderer';
import { AUTOMATIONS_ACTOR } from '../automations.constants';
import { AutomationPeersClient, type AutomationUser } from '../internal/peers.client';
import { TeamThreadService } from '../team-thread.service';
import { type AutomationFacts } from './facts';
import { sha1, type AutomationEvent } from './trigger-event';

/** Everything an action needs besides the action itself. */
export interface ActionContext {
  ruleId: string;
  /** The rule's name — the subject line of an e-mail action that has none of its own. */
  ruleName?: string;
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
  /** A bare address (`to: number` with `email`) — reachable by e-mail only. */
  email?: string;
}

const HTTP_TIMEOUT_MS = 8_000;

/**
 * The "what it does" half of the rule engine. Every action answers with an
 * `AutomationRunAction` — what was attempted, to whom, and how it went —
 * which is what the firing log stores and the test-run dialog shows.
 *
 * `send_sms` and `send_email` resolve the same recipients the same way (the
 * client's thread, a technician's team thread, a user, a role, a bare
 * number or address) and differ only in the address each needs: a text goes
 * to the thread's number or the employee's phone, an e-mail to the contact's
 * address on their thread, the employee's work address, or the bare address
 * itself. Workiz's "Both" is one rule carrying one of each; they run in
 * order under their own idempotency keys. A recipient the channel cannot
 * reach is logged `skipped` with the reason (`no phone`, `no email`), never
 * failed.
 *
 * Deliberate limits of this milestone, reported honestly rather than
 * failing silently (outcome `unsupported`):
 *
 *   send_in_app               a caller-less in-app line needs a thread
 *                             author the outbound module does not expose yet
 *                             (the in-app bell is a later wave).
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
    private readonly conversations: ConversationsRepository,
  ) {}

  async run(action: AutomationAction, ctx: ActionContext): Promise<AutomationRunAction[]> {
    switch (action.type) {
      case 'send_sms':
        return this.sendSms(action, ctx);
      case 'send_email':
        return this.sendEmail(action, ctx);
      case 'webhook':
        return [await this.webhook(action, ctx)];
      case 'send_in_app':
        return [
          {
            type: action.type,
            to: action.to,
            outcome: 'unsupported',
            error: `${action.type} is not sent by the engine yet (text and e-mail only)`,
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
    // A bare address has nothing to text — said before any thread is opened for it.
    if (recipient.email) return { ...base, error: 'no phone' };
    try {
      // A test run must leave the table exactly as it found it: the
      // find-or-create resolvers open a thread (and its ADDR# pointers) for
      // a recipient who has none, so a dry run reads instead — and renders
      // without one when there is nothing to read.
      const conversation = ctx.dryRun
        ? await this.existingConversation(recipient)
        : await this.openConversation(recipient);

      const to = recipient.user?.phone ?? recipient.phone;
      if (recipient.user && !to) return { ...base, error: 'the employee has no personal phone' };

      const rendered = await this.renderer.render(
        {
          ...(action.templateId ? { templateId: action.templateId } : {}),
          ...(action.body ? { body: action.body } : {}),
          format: 'text',
        },
        this.renderRefs(ctx, recipient, conversation),
      );
      const body = rendered.body.trim();
      if (!body) return { ...base, error: 'the text rendered empty' };
      if (ctx.dryRun) {
        return { ...base, outcome: 'dry_run', body, ...(conversation ? { conversationId: conversation.id } : {}) };
      }
      if (!conversation) return { ...base, error: 'no conversation for the recipient' };

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

  /**
   * The ids the renderer loads the short-code context from, the same for a
   * text and an e-mail — plus the call itself on a `call.completed` firing,
   * which nothing could load from an id (`{{caller_number}}`,
   * `{{call_status}}`, `{{call_flow}}`).
   */
  private renderRefs(ctx: ActionContext, recipient: Recipient, conversation: Conversation | undefined): RenderRefs {
    const call = ctx.facts.call;
    return {
      ...(conversation ? { conversationId: conversation.id } : {}),
      contactId: recipient.contactId ?? ctx.facts.deal?.contactId,
      dealId: ctx.facts.deal?.id,
      userId: recipient.user?.id,
      values: ctx.values,
      ...(call
        ? {
            call: {
              from: call.from,
              to: call.to,
              direction: call.direction,
              outcome: ctx.event.call?.outcome,
              flowName: call.flowName,
              lineName: call.lineName,
            },
          }
        : {}),
    };
  }

  // -------------------------------------------------------------- send_email

  private async sendEmail(action: AutomationAction, ctx: ActionContext): Promise<AutomationRunAction[]> {
    const recipients = await this.recipients(action, ctx);
    if (!recipients.length) {
      return [{ type: action.type, to: action.to, outcome: 'skipped', error: 'no recipient resolved' }];
    }

    const out: AutomationRunAction[] = [];
    for (const recipient of recipients) {
      out.push(await this.emailTo(action, ctx, recipient));
    }
    return out;
  }

  /**
   * One e-mail. The address is the employee's work e-mail (directory), the
   * bare address itself, or the contact's e-mail on their thread — the thread
   * copies it from CRM when it is opened and follows `contact.updated`. The
   * subject and body render through the same short-code context as a text.
   *
   * A plain body renders as `text` on purpose: `sendSystem` escapes it and
   * turns its line breaks into `<br>` exactly once (`emailBodies`). A body
   * that already carries markup (an imported Workiz e-mail template) renders
   * as `html`, where the substituted values are escaped and the tags are
   * kept. Rendering a plain body as html would escape the values twice.
   */
  private async emailTo(
    action: AutomationAction,
    ctx: ActionContext,
    recipient: Recipient,
  ): Promise<AutomationRunAction> {
    const base: AutomationRunAction = { type: action.type, to: recipient.label, outcome: 'skipped' };
    // An employee without a work address: said before their thread is opened.
    if (recipient.user && !recipient.user.email) return { ...base, error: 'no email' };
    try {
      const conversation = ctx.dryRun
        ? await this.existingConversation(recipient)
        : await this.openConversation(recipient);

      const to = recipient.user?.email ?? recipient.email ?? conversation?.addresses?.emails?.[0];
      if (!to) return { ...base, error: 'no email' };

      const rendered = await this.renderer.render(
        {
          ...(action.templateId ? { templateId: action.templateId } : {}),
          ...(action.body ? { body: action.body, format: looksLikeHtml(action.body) ? 'html' : 'text' } : {}),
          ...(action.subject !== undefined ? { subject: action.subject } : {}),
        },
        this.renderRefs(ctx, recipient, conversation),
      );
      const body = rendered.body.trim();
      if (!body) return { ...base, error: 'the text rendered empty' };
      const subject = rendered.subject?.trim() || ctx.ruleName?.trim();
      if (!subject) return { ...base, error: 'no subject' };
      if (ctx.dryRun) {
        return { ...base, outcome: 'dry_run', body, subject, ...(conversation ? { conversationId: conversation.id } : {}) };
      }
      if (!conversation) return { ...base, error: 'no conversation for the recipient' };

      const result = await this.send.sendSystem({
        conversation,
        channel: 'email',
        body,
        subject,
        to,
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
        subject,
        messageId: result.message.id,
        conversationId: result.message.conversationId,
      };
    } catch (error) {
      if (error instanceof RecipientOptedOutException) return { ...base, outcome: 'skipped', error: 'opted out' };
      // No `MESSAGING_EMAIL_FROM`: nothing can be mailed by anybody, which is
      // a fact about the deployment, not a failure of this rule.
      if (error instanceof NotImplementedException) {
        return { ...base, outcome: 'skipped', error: 'email is not configured (MESSAGING_EMAIL_FROM)' };
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rule ${ctx.ruleId} could not e-mail ${recipient.label}: ${message}`);
      return { ...base, outcome: 'failed', error: message };
    }
  }

  /** The recipient's thread, opened if they have none — the real send path. */
  private async openConversation(recipient: Recipient): Promise<Conversation | undefined> {
    if (recipient.user) return this.threads.forTechnician(recipient.user);
    if (recipient.contactId) return (await this.send.conversationForContact(recipient.contactId)).conversation;
    if (recipient.phone) return (await this.send.conversationForParty({ phone: recipient.phone })).conversation;
    if (recipient.email) return (await this.send.conversationForEmail(recipient.email)).conversation;
    return undefined;
  }

  /**
   * The recipient's thread only if it already exists — three `GetItem`s at
   * most and never a write. `POST /automations/:id/test` says "nothing is
   * sent, nothing is logged", and that has to include the thread and the
   * `ADDR#` pointers a first text would open.
   */
  private async existingConversation(recipient: Recipient): Promise<Conversation | undefined> {
    if (recipient.user) return (await this.conversations.getByParty('user', recipient.user.id)) ?? undefined;
    if (recipient.contactId) return (await this.conversations.getByParty('contact', recipient.contactId)) ?? undefined;
    if (recipient.phone) {
      const pointer = await this.conversations.getByAddress(tryNormalizePhone(recipient.phone) ?? recipient.phone);
      return pointer ? ((await this.conversations.get(pointer.conversationId)) ?? undefined) : undefined;
    }
    if (recipient.email) {
      const pointer = await this.conversations.getByAddress(recipient.email);
      return pointer ? ((await this.conversations.get(pointer.conversationId)) ?? undefined) : undefined;
    }
    return undefined;
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
        if (contactId) return [{ key: `contact:${contactId}`, label: 'client', contactId }];
        // A missed call carries no contact id — the client *is* the other
        // end of the call. The number is routed through ADDR# and CRM the
        // same way an inbound text from it would be, so a caller CRM knows
        // lands in their own thread and a stranger gets an `unknown` one.
        const phone = this.otherEnd(ctx);
        return phone ? [{ key: `num:${phone}`, label: 'client', phone }] : [];
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
      case 'number': {
        if (action.number) return [{ key: `num:${action.number}`, label: action.number, phone: action.number }];
        // The builder's "a number" may be an e-mail address instead (`AutomationAction.email`).
        const address = action.email?.trim().toLowerCase();
        return address ? [{ key: `email:${address}`, label: address, email: address }] : [];
      }
      default:
        return [];
    }
  }

  /** The customer's own number on a call or an inbound message, if the event carries one. */
  private otherEnd(ctx: ActionContext): string | undefined {
    const call = ctx.facts.call;
    if (call) return call.direction === 'outbound' ? call.to : call.from;
    return ctx.facts.message?.from;
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
