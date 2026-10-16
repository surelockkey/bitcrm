import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DealStatus, JobSuperStatus, isFieldTeamMember, isSubcontractor, type Conversation, type Message } from '@bitcrm/types';
import {
  isDealStatusChangedPayload,
  isDealTechAssignedPayload,
  isDealTechUnassignedPayload,
} from '../automations/deal-events';
import { type DealScheduleSnapshot } from '../automations/engine/deal-snapshot.repository';
import { AutomationPeersClient, type AutomationUser } from '../automations/internal/peers.client';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { type MessageUpsertedEvent } from '../realtime/realtime-events';
import { ContextLoader } from '../templates/context-loader';
import { splitTimeSlot } from '../templates/date-format';
import type { RenderContext, RenderDeal } from '../templates/render-context';
import { ExpoPushClient, isDeviceNotRegistered, type ExpoPushMessage } from './expo-push.client';
import { PUSH_CONFIG, type PushConfig } from './push.config';
import { type PushData, type PushType } from './push.constants';
import { PushRepository } from './push.repository';
import {
  clientNameOf,
  jobAssignedPush,
  jobCanceledPush,
  jobRescheduledPush,
  jobUnassignedPush,
  messagePreview,
  type PushContent,
} from './push-texts';
import { fullName } from '../templates/short-codes';

/**
 * The SQS delivery an event came in (`EventDeliveryMeta` from the shared
 * consumer, structurally): `eventId` is the same on every redelivery.
 */
export interface PushDelivery {
  eventId?: string;
}

/** Why nothing was pushed for an event — logged, and what the unit tests assert on. */
export type PushSkip =
  | 'disabled'
  | 'malformed'
  | 'duplicate'
  | 'no_deal'
  | 'closed_deal'
  | 'not_on_roster'
  | 'still_on_roster'
  | 'not_canceled'
  | 'not_rescheduled'
  | 'no_recipients'
  // messages
  | 'not_pushable'
  | 'own_message'
  | 'stale'
  | 'no_conversation'
  | 'failed';

/** What happened for one person. */
export type RecipientOutcome = 'sent' | 'failed' | 'unknown_user' | 'inactive' | 'subcontractor' | 'not_field_team' | 'no_tokens';

export interface PushResult {
  skipped?: PushSkip;
  recipients: Record<string, RecipientOutcome>;
}

export interface ReschedulePush {
  dealId: string;
  previous: DealScheduleSnapshot;
  next: DealScheduleSnapshot;
  eventId?: string;
  /** Who moved the job (`deal.updated`'s `updatedBy`) — not told about their own change. */
  actorId?: string;
}

const CLOSED: ReadonlyArray<string> = [JobSuperStatus.CANCELED, JobSuperStatus.DONE];

/**
 * A realtime frame for a line older than this is a status update or a late
 * catch-up (reconciliation, fallback replay) — not news worth waking a phone.
 */
export const MESSAGE_PUSH_MAX_AGE_MS = 15 * 60_000;

/** Team threads are the office talking — the technician sees "Office", whoever typed it. */
export const OFFICE_TITLE = 'Office';

/**
 * What can be ruled out from the line alone, before its thread is read:
 * notes, and every outbound text or email (only an in-app line goes out
 * to a technician). Most frames are delivery-status updates of exactly
 * those, and every messaging task hears every frame.
 */
export const mayBePushed = (m: Message): boolean =>
  m.channel !== 'note' && (m.direction === 'inbound' || m.channel === 'in_app');

/** Who a message is for, decided from the line and its thread alone (no reads). */
export type MessageRoute =
  | { kind: 'team' | 'group'; recipients: string[]; title: string }
  | { kind: 'client' };

/**
 * Which threads wake a technician (the `assigned_only` scope, narrowed to
 * news):
 *
 *   team (their 1:1 with the office)  an in-app line from the office → the employee, "Office".
 *                                     Their own lines are `inbound` there; an SMS / email to
 *                                     their phone or mailbox already reached them.
 *   group                             an in-app line → the members but its author, "<author> · <group>".
 *   client (contact / company)        an inbound text or email → the technicians on the thread's job.
 *
 * Anything else — unknown numbers, notes, outbound client texts — is not pushed.
 */
export function routeMessage(m: Message, c: Conversation): MessageRoute | PushSkip {
  if (!mayBePushed(m)) return 'not_pushable';
  if (c.kind === 'team' && c.partyKind === 'user' && c.partyId) {
    if (m.channel !== 'in_app') return 'not_pushable';
    if (m.direction !== 'outbound' || m.sentByUserId === c.partyId) return 'own_message';
    return { kind: 'team', recipients: [c.partyId], title: OFFICE_TITLE };
  }
  if (c.kind === 'group') {
    if (m.channel !== 'in_app') return 'not_pushable';
    const author = m.sentByName?.trim() || 'Team';
    return {
      kind: 'group',
      recipients: (c.memberIds ?? []).filter((id) => id !== m.sentByUserId),
      title: c.name?.trim() ? `${author} · ${c.name.trim()}` : author,
    };
  }
  if ((c.partyKind === 'contact' || c.partyKind === 'company') && c.partyId) {
    if (m.direction !== 'inbound') return 'not_pushable';
    if (m.origin === 'system') return 'not_pushable';
    return { kind: 'client' };
  }
  return 'not_pushable';
}
const isDeleted = (deal: RenderDeal) => deal.status === DealStatus.DELETED;
const isClosed = (deal: RenderDeal) => isDeleted(deal) || CLOSED.includes(deal.superStatus ?? '');

/**
 * A reschedule as the technician feels it: the visit's day or its start
 * moved. The end alone moving is not one — closing a job stamps its end
 * (`CONFIG#JOB_RULES` "Update Job End Time"), and the engine's own
 * `isReschedule` counts that.
 */
export const isTechReschedule = (previous: DealScheduleSnapshot, next: DealScheduleSnapshot): boolean =>
  previous.scheduledDate !== next.scheduledDate ||
  splitTimeSlot(previous.scheduledTimeSlot).start !== splitTimeSlot(next.scheduledTimeSlot).start;

/**
 * Push notifications to the technician app (Workiz parity: a technician
 * learns about a change without opening the app). Fed by the
 * `deal-events-to-messaging` handler (`AutomationDealEventsHandler`) and,
 * for messages, by the realtime bus (`PushMessageListener`).
 *
 *   deal.tech_assigned           → that technician          "New job assigned"
 *   reschedule (DEALSNAP# diff)  → the job's technicians    "Job rescheduled"
 *   deal.status_changed→canceled → the job's technicians    "Job canceled"
 *   deal.tech_unassigned         → that technician          "Removed from job"
 *   message.upserted (new line)  → see `routeMessage`       "<sender>": the text, ≤ 140 chars
 *
 * Once per event: `PUSHSENT#<type>#<eventId>` (`message#<messageId>` for a
 * line) is claimed before anything is read, so an SQS redelivery — or the
 * other messaging tasks hearing the same realtime frame — pushes nothing. Recipients must be active,
 * regular (a subcontractor cannot sign in), on the field team (no office
 * roles in this first version) and have a registered device; whoever
 * caused the change is not told about it. Never throws: the event consumer
 * must not fail — or be retried — because a notification could not go.
 */
@Injectable()
export class PushNotifier {
  private readonly logger = new Logger(PushNotifier.name);

  constructor(
    @Inject(PUSH_CONFIG) private readonly config: PushConfig,
    private readonly repository: PushRepository,
    private readonly expo: ExpoPushClient,
    private readonly peers: AutomationPeersClient,
    private readonly context: ContextLoader,
    @Optional() private readonly conversations?: ConversationsRepository,
  ) {}

  /** `deal.tech_assigned` — one technician joined the roster. */
  onTechAssigned(payload: unknown, delivery?: PushDelivery): Promise<PushResult> {
    return this.safely('deal.tech_assigned', async () => {
      if (!isDealTechAssignedPayload(payload)) return skip('malformed');
      const { dealId, techId } = payload;
      if (payload.assignedBy === techId) return skip('no_recipients');
      return this.forJob('job_assigned', delivery, dealId, (deal) => {
        if (isClosed(deal)) return 'closed_deal';
        return deal.assignedTechIds?.includes(techId) ? [techId] : 'not_on_roster';
      }, jobAssignedPush);
    });
  }

  /** `deal.tech_unassigned` — one technician left the roster. */
  onTechUnassigned(payload: unknown, delivery?: PushDelivery): Promise<PushResult> {
    return this.safely('deal.tech_unassigned', async () => {
      if (!isDealTechUnassignedPayload(payload)) return skip('malformed');
      const { dealId, techId } = payload;
      if (payload.unassignedBy === techId) return skip('no_recipients');
      return this.forJob('job_unassigned', delivery, dealId, (deal) => {
        if (isClosed(deal)) return 'closed_deal';
        return deal.assignedTechIds?.includes(techId) ? 'still_on_roster' : [techId];
      }, jobUnassignedPush);
    });
  }

  /** `deal.status_changed` — only a move to Canceled is pushed. */
  onStatusChanged(payload: unknown, delivery?: PushDelivery): Promise<PushResult> {
    return this.safely('deal.status_changed', async () => {
      if (!isDealStatusChangedPayload(payload)) return skip('malformed');
      if (payload.newStatus !== JobSuperStatus.CANCELED || payload.oldStatus === JobSuperStatus.CANCELED) {
        return skip('not_canceled');
      }
      return this.forJob(
        'job_canceled',
        delivery,
        payload.dealId,
        (deal) => {
          if (isDeleted(deal)) return 'closed_deal';
          if (deal.superStatus !== JobSuperStatus.CANCELED) return 'not_canceled';
          return deal.assignedTechIds ?? [];
        },
        jobCanceledPush,
        payload.changedBy,
      );
    });
  }

  /** The job's schedule moved since the last event (`DEALSNAP#` comparison in the deal events handler). */
  onRescheduled(input: ReschedulePush): Promise<PushResult> {
    return this.safely('reschedule', async () => {
      if (!isTechReschedule(input.previous, input.next)) return skip('not_rescheduled');
      return this.forJob(
        'job_rescheduled',
        { eventId: input.eventId },
        input.dealId,
        (deal) => (isClosed(deal) ? 'closed_deal' : deal.assignedTechIds ?? []),
        jobRescheduledPush,
        input.actorId,
      );
    });
  }

  /**
   * A message was appended (or its status changed) — the realtime frame
   * every task hears. Pushed once per message, by whichever task claims it.
   */
  onMessageUpserted(event: MessageUpsertedEvent): Promise<PushResult> {
    return this.safely('message.upserted', async () => {
      const m = event?.message;
      if (!m?.id || !m.conversationId) return skip('malformed');
      if (!mayBePushed(m)) return skip('not_pushable');
      const age = Date.now() - Date.parse(m.createdAt);
      if (!(age <= MESSAGE_PUSH_MAX_AGE_MS)) return skip('stale');
      const conversation = event.conversation ?? (await this.conversations?.get(m.conversationId)) ?? null;
      if (!conversation) return skip('no_conversation');
      const route = routeMessage(m, conversation);
      if (typeof route === 'string') return skip(route);
      const preview = messagePreview(m);
      if (!preview) return skip('not_pushable');
      if (!(await this.claim('message', m.id))) return skip('duplicate');

      const data: PushData = { type: 'message', conversationId: conversation.id, ...(m.dealId ? { dealId: m.dealId } : {}) };
      if (route.kind !== 'client') {
        const recipients = route.recipients.filter((id) => id !== m.sentByUserId);
        if (!recipients.length) return skip('no_recipients');
        return this.deliver(recipients, { title: route.title, body: preview, data }, `message ${m.id}`);
      }

      // A client's thread: the technicians on its job, while the job is open.
      const ctx = await this.context.load({ conversationId: conversation.id, dealId: m.dealId });
      const deal = ctx.deal;
      if (!deal?.id) return skip('no_deal');
      if (isClosed(deal)) return skip('closed_deal');
      const recipients = (deal.assignedTechIds ?? []).filter((id) => id !== m.sentByUserId);
      if (!recipients.length) return skip('no_recipients');
      const title =
        (conversation.partyKind === 'company' ? ctx.company?.title?.trim() : fullName(ctx.contact)) ||
        clientNameOf(ctx) ||
        'Client';
      return this.deliver(recipients, { title, body: preview, data: { ...data, dealId: deal.id } }, `message ${m.id}`);
    });
  }

  // -------------------------------------------------------------- internals

  /** Claim the event, read the job as it is now, pick the recipients and push. */
  private async forJob(
    type: PushType,
    delivery: PushDelivery | undefined,
    dealId: string,
    pick: (deal: RenderDeal) => string[] | PushSkip,
    content: (ctx: RenderContext) => PushContent,
    actorId?: string,
  ): Promise<PushResult> {
    if (!(await this.claim(type, delivery?.eventId))) return skip('duplicate');
    const ctx = await this.context.load({ dealId });
    if (!ctx.deal?.id) return skip('no_deal');
    const picked = pick(ctx.deal);
    if (typeof picked === 'string') return skip(picked);
    const recipients = picked.filter((id) => id && id !== actorId);
    if (!recipients.length) return skip('no_recipients');
    return this.deliver(recipients, content(ctx), `${type} ${dealId}`);
  }

  /** `true` when this process is the first to handle the occurrence (or there is no id to key it on). */
  private async claim(type: PushType, eventId: string | undefined): Promise<boolean> {
    if (!eventId) return true;
    return this.repository.claim(`${type}#${eventId}`);
  }

  /** Every device of every eligible recipient, one Expo call (batched by the client), dead tokens forgotten. */
  protected async deliver(userIds: string[], content: PushContent, label: string): Promise<PushResult> {
    const outcomes: Record<string, RecipientOutcome> = {};
    const ids = [...new Set(userIds)];
    const devices = await Promise.all(ids.map((id) => this.devicesOf(id, outcomes)));
    const targets = ids.flatMap((userId, i) => devices[i].map((token) => ({ userId, token })));

    if (targets.length) {
      const messages: ExpoPushMessage[] = targets.map(({ token }) => ({
        to: token,
        title: content.title,
        body: content.body,
        data: content.data,
        sound: 'default',
        priority: 'high',
      }));
      const tickets = await this.expo.send(messages);
      for (const [i, { userId, token }] of targets.entries()) {
        if (tickets[i]?.status === 'ok') outcomes[userId] = 'sent';
        else if (outcomes[userId] !== 'sent') outcomes[userId] = 'failed';
        if (isDeviceNotRegistered(tickets[i])) await this.forget(userId, token);
      }
    }
    this.logger.log(`Push ${label} "${content.title}": ${JSON.stringify(outcomes)}`);
    return { recipients: outcomes };
  }

  /** The person's device tokens, or none with the reason recorded. */
  private async devicesOf(userId: string, outcomes: Record<string, RecipientOutcome>): Promise<string[]> {
    try {
      const reason = ineligible(await this.peers.user(userId));
      if (reason) {
        outcomes[userId] = reason;
        return [];
      }
      const tokens = await this.repository.tokensFor(userId);
      if (!tokens.length) outcomes[userId] = 'no_tokens';
      return tokens.map((t) => t.token);
    } catch (error) {
      this.logger.warn(`Push devices of ${userId} unreadable: ${error instanceof Error ? error.message : error}`);
      outcomes[userId] = 'failed';
      return [];
    }
  }

  /** Expo says the app is gone from that phone — the token will never work again. */
  private async forget(userId: string, token: string): Promise<void> {
    try {
      await this.repository.unregister(userId, token);
      this.logger.log(`Forgot push token of ${userId}: DeviceNotRegistered`);
    } catch (error) {
      this.logger.warn(`Dead push token of ${userId} not removed: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** The kill switch, and the promise that nothing here ever fails the caller. */
  protected async safely(what: string, run: () => Promise<PushResult>): Promise<PushResult> {
    if (!this.config.enabled) return skip('disabled');
    try {
      const result = await run();
      if (result.skipped && result.skipped !== 'duplicate') this.logger.debug(`Push for ${what} skipped: ${result.skipped}`);
      return result;
    } catch (error) {
      this.logger.warn(`Push for ${what} failed: ${error instanceof Error ? error.message : error}`);
      return skip('failed');
    }
  }
}

function skip(reason: PushSkip): PushResult {
  return { skipped: reason, recipients: {} };
}

/** Why this person gets no push, or nothing when they may. */
function ineligible(user: AutomationUser | null): RecipientOutcome | undefined {
  if (!user) return 'unknown_user';
  if (user.status && user.status !== 'active') return 'inactive';
  if (isSubcontractor(user)) return 'subcontractor';
  if (!isFieldTeamMember({ roleId: user.roleId ?? '', fieldTeamMember: user.fieldTeamMember })) return 'not_field_team';
  return undefined;
}
