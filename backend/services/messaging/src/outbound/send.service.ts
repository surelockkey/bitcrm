import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { getDataScopeFilter, hasPermission, normalizePhone, tryNormalizePhone } from '@bitcrm/shared';
import {
  DataScope,
  type Conversation,
  type ConversationKind,
  type JwtUser,
  type Message,
  type MessageAttachment,
  type MessageOrigin,
  type ResolvedPermissions,
} from '@bitcrm/types';
import { UserLookupService } from '../api/access/user-lookup.service';
import { messageSk } from '../common/constants/dynamo.constants';
import { countersDelta } from '../conversations/conversation-keys';
import { ConversationsRepository, StaleConversationError } from '../conversations/conversations.repository';
import { InboxCountersRepository } from '../counters/inbox-counters.repository';
import { MessagesRepository, type AppendResult, type MessageKey } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { TeamAccessService, isTeamKind } from '../team/team-access.service';
import { MAX_ATTACHMENT_BYTES, type SendAttachmentDto, type SendMessageDto, type StartConversationMessageDto } from './dto/send-message.dto';
import { CrmContactsClient } from './internal/crm-contacts.client';
import { DealContextClient } from './internal/deal-context.client';
import { OutboundEventsPublisher } from './outbound-events';
import { OutboundQueueProducer } from './outbound-queue.producer';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { SenderResolver } from './sender.resolver';
import { MESSAGE_TEMPLATE_RENDERER, type MessageTemplateRenderer } from './template-renderer';

/** Who is sending: the JWT user and what `PermissionGuard` resolved for them. */
export interface SendCaller {
  user: JwtUser;
  perms?: ResolvedPermissions;
}

/**
 * An outbound SMS the service sends on its own behalf (design §10 M21:
 * automations, technician-triggered notices) — no HTTP caller, no DTO, no
 * permission check; the opt-out rule, the sender chain and the
 * `CLIENTMSG#` idempotency guard still apply.
 */
export interface SystemSendInput {
  conversation: Conversation;
  /** Already rendered; blank is refused. */
  body: string;
  /** E.164 among the conversation phones; the first one when absent. */
  to?: string;
  dealId?: string;
  origin: Extract<MessageOrigin, 'automation' | 'system'>;
  automationRuleId?: string;
  /** The user on whose behalf it goes (a technician's "on my way"), if any. */
  sentByUserId?: string;
  templateId?: string;
  /** Deterministic for automations (`automation:<rule>:<deal>:<tech>:<date>`) so a replay sends once. */
  clientMessageId: string;
  /** `createdBy` on the idempotency pointer — the user, or a `system:*` actor. */
  actorId: string;
  /** Sender override (rung 1 of the chain); otherwise the conversation's sticky number and on down. */
  fromNumber?: string;
}

export interface SystemSendResult {
  message: Message;
  /** The idempotency key was already used: `message` is the first one, nothing was sent again. */
  duplicate: boolean;
}

/** Prefix of every composer upload; the key never leaves the caller's own folder. */
export const uploadKey = (userId: string, attachmentId: string) =>
  `messaging/uploads/${userId}/${attachmentId}`;

/** A party's conversation and whether this call opened it. */
export interface FoundConversation {
  conversation: Conversation;
  created: boolean;
}

/**
 * Raised for a recipient on the STOP list (design §4.4: 422
 * `RECIPIENT_OPTED_OUT`). Its own class so the filter's generic message
 * still carries the code the UI switches on.
 */
export class RecipientOptedOutException extends HttpException {
  constructor(address: string) {
    super(
      `RECIPIENT_OPTED_OUT: ${address} has opted out of SMS; ask them to text START, or call`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** An SMS in an employee's thread has nowhere to go: no personal phone on their user record (design §6). */
export class EmployeeHasNoPhoneException extends HttpException {
  constructor(userId: string) {
    super(
      `EMPLOYEE_HAS_NO_PHONE: user ${userId} has no personal phone on their profile; add one or message them in-app`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** Who a team / group in-app line is for: the roster minus the author, or the employee (design §6). */
export function teamRecipients(conversation: Conversation, senderId: string): string[] {
  if (conversation.kind === 'group') return (conversation.memberIds ?? []).filter((id) => id !== senderId);
  if (conversation.kind === 'team' && conversation.partyId && conversation.partyId !== senderId) {
    return [conversation.partyId];
  }
  return [];
}

/**
 * The accept half of outbound messages (design §4.4 steps 1–3, §6):
 * authorise, then by channel —
 *
 *   sms     refuse opted-out recipients, pick the sender, store the message
 *           as `queued` under the `CLIENTMSG#` idempotency guard and hand it
 *           to the FIFO queue; the worker (`OutboundWorker`) does the Twilio
 *           call. In an employee's thread the recipient is their personal
 *           phone (user-service) and the sender the company's default number.
 *   in_app  team / group threads only: stored `sent` and pushed over SSE to
 *           the members — no provider. An employee's own line marks the
 *           office's `unread`, as their SMS would.
 *   email   M17, answers 501.
 */
@Injectable()
export class SendService {
  private readonly logger = new Logger(SendService.name);
  /** Pure rules, no dependencies — the team-chat scope the send path enforces. */
  private readonly teamAccess = new TeamAccessService();

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly sender: SenderResolver,
    private readonly queue: OutboundQueueProducer,
    private readonly deals: DealContextClient,
    private readonly crm: CrmContactsClient,
    private readonly events: OutboundEventsPublisher,
    @Optional() @Inject(MESSAGE_TEMPLATE_RENDERER) private readonly templates?: MessageTemplateRenderer,
    @Optional() private readonly realtime?: RealtimePublisher,
    @Optional() private readonly users?: UserLookupService,
    @Optional() private readonly inboxCounters?: InboxCountersRepository,
  ) {}

  /** `POST /conversations/:id/messages`. */
  async sendToConversation(conversationId: string, dto: SendMessageDto, caller: SendCaller): Promise<Message> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return this.send(conversation, dto, caller);
  }

  /** `POST /messages` — find or create the party's conversation first. */
  async sendToParty(dto: StartConversationMessageDto, caller: SendCaller): Promise<Message> {
    const { conversation } = await this.conversationForParty(dto);
    const toAddress = dto.toAddress ?? dto.phone;
    return this.send(conversation, { ...dto, toAddress }, caller);
  }

  /**
   * The client-side half of `POST /conversations` (design §7.1) — the same
   * find-or-create `POST /messages` runs before sending: a contact gets (or
   * already has) its `client` thread; a bare number is routed through
   * `ADDR#`, then CRM, and opens an `unknown` thread when nobody owns it.
   */
  async conversationForParty(input: { contactId?: string; phone?: string }): Promise<FoundConversation> {
    if (input.contactId) return this.conversationForContact(input.contactId, input.phone);
    if (input.phone) return this.conversationForPhone(normalizePhone(input.phone));
    throw new BadRequestException('contactId or phone is required');
  }

  // ------------------------------------------------------------- the path

  private async send(conversation: Conversation, dto: SendMessageDto, caller: SendCaller): Promise<Message> {
    await this.authorise(conversation, dto, caller);

    if (dto.channel === 'in_app') return this.sendInApp(conversation, dto, caller);
    if (dto.channel !== 'sms') {
      // TODO(M17 email): route once the channel exists.
      throw new NotImplementedException(`Sending over ${dto.channel} is not available yet`);
    }

    const target = await this.smsTarget(conversation, dto);
    conversation = target.conversation;
    const to = target.to;
    if (await this.optOuts.isOptedOut('sms', to)) throw new RecipientOptedOutException(to);

    const body = await this.renderBody(conversation, dto);
    const attachments = this.attachments(dto.attachments, caller.user.id);
    const dealId = dto.dealId ?? conversation.lastDealId;
    // An employee is texted from the company's default / sticky number, never
    // a job's area or source number (design §6: "the same sender as for clients"
    // means the workspace number, not the job's tracking line).
    const sender = await this.sender.resolve({
      requested: dto.fromNumber,
      conversation,
      dealId: target.employee ? undefined : dealId,
    });

    const now = new Date().toISOString();
    const message: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      channel: 'sms',
      direction: 'outbound',
      body,
      from: sender.from,
      to,
      businessNumber: sender.from,
      senderSource: sender.source,
      status: 'queued',
      provider: 'twilio',
      origin: 'user',
      sentByUserId: caller.user.id,
      dealId: dto.dealId,
      templateId: dto.templateId,
      attachments,
      createdAt: now,
      updatedAt: now,
    };

    const accepted = await this.accept(conversation, message, { clientMessageId: dto.clientMessageId, createdBy: caller.user.id });
    return accepted.message;
  }

  /**
   * The service's own sends (automations, "on my way" / "late"): the same
   * path as a composer send from the opt-out check on, minus authorisation
   * and templating — the caller has rendered the text and checked its own
   * rules. Throws `RecipientOptedOutException` like the HTTP path; a repeat
   * of `clientMessageId` answers `duplicate: true` with the first message.
   */
  async sendSystem(input: SystemSendInput): Promise<SystemSendResult> {
    const { conversation } = input;
    const to = this.recipient(conversation, input.to);
    if (await this.optOuts.isOptedOut('sms', to)) throw new RecipientOptedOutException(to);

    const body = input.body.trim();
    if (!body) throw new BadRequestException('body must not be blank');

    const dealId = input.dealId ?? conversation.lastDealId;
    const sender = await this.sender.resolve({ requested: input.fromNumber, conversation, dealId });

    const now = new Date().toISOString();
    const message: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      channel: 'sms',
      direction: 'outbound',
      body,
      from: sender.from,
      to,
      businessNumber: sender.from,
      senderSource: sender.source,
      status: 'queued',
      provider: 'twilio',
      origin: input.origin,
      sentByUserId: input.sentByUserId,
      automationRuleId: input.automationRuleId,
      dealId: input.dealId,
      templateId: input.templateId,
      createdAt: now,
      updatedAt: now,
    };
    return this.accept(conversation, message, { clientMessageId: input.clientMessageId, createdBy: input.actorId });
  }

  /**
   * Design §4.4 steps 2–3 for a built message: store it `queued` under the
   * `CLIENTMSG#` guard, hand it to the FIFO queue, fan out realtime and the
   * `conversation.updated` event. On a duplicate key the first message is
   * returned instead (§4.9) — nothing is sent twice.
   */
  private async accept(
    conversation: Conversation,
    message: Message,
    opts: { clientMessageId: string; createdBy: string },
  ): Promise<SystemSendResult> {
    const now = message.createdAt;
    const to = message.to;
    const result = await this.messages.appendOutbound({
      message,
      clientMessageId: opts.clientMessageId,
      createdBy: opts.createdBy,
      conversation,
      at: now,
    });
    if (result.duplicate) return { message: await this.firstSubmit(result), duplicate: true };

    const key: MessageKey = { conversationId: conversation.id, createdAt: now, messageId: message.id };
    try {
      const outcome = await this.queue.enqueue(key);
      this.logger.log(`Accepted ${message.id} for ${to} via ${message.senderSource} (${outcome})`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Could not enqueue ${message.id}: ${reason}`);
      await this.messages.updateStatus(key, {
        status: 'failed',
        errorCode: 'ENQUEUE_FAILED',
        errorMessage: reason,
        at: new Date().toISOString(),
      });
      throw new BadGatewayException('The message was stored but could not be queued for sending');
    }

    this.realtime?.messageUpserted(message, result.conversation, now);
    void this.events.conversationUpdated(conversation.id);
    return { message, duplicate: false };
  }

  /**
   * `channel: in_app` (design §6): no provider — the line is stored `sent`
   * and the members learn about it over SSE. An employee writing on their
   * own thread is the party speaking (`inbound`, `origin: employee`, the
   * office's `unread` bumps, as their SMS would); anyone else, and every
   * group line, is `outbound` from a user. The author's own `READ#` marker
   * is advanced so the line never counts as unread for them.
   */
  private async sendInApp(conversation: Conversation, dto: SendMessageDto, caller: SendCaller): Promise<Message> {
    if (!isTeamKind(conversation.kind)) {
      throw new NotImplementedException('In-app messages can only be sent in team and group conversations');
    }
    const body = await this.renderBody(conversation, dto);
    const attachments = this.attachments(dto.attachments, caller.user.id);
    const fromParty = conversation.kind === 'team' && conversation.partyId === caller.user.id;
    const mentions = dto.mentions?.length ? [...new Set(dto.mentions)] : undefined;

    const now = new Date().toISOString();
    const message: Message = {
      id: randomUUID(),
      conversationId: conversation.id,
      channel: 'in_app',
      direction: fromParty ? 'inbound' : 'outbound',
      body,
      status: 'sent',
      origin: fromParty ? 'employee' : 'user',
      sentByUserId: caller.user.id,
      sentByName: await this.senderName(caller.user.id),
      dealId: dto.dealId,
      templateId: dto.templateId,
      mentions,
      attachments,
      createdAt: now,
      sentAt: now,
      updatedAt: now,
    };

    const result = await this.messages.appendOutbound({
      message,
      clientMessageId: dto.clientMessageId,
      createdBy: caller.user.id,
      conversation,
      at: now,
      markUnread: fromParty,
    });
    if (result.duplicate) return this.firstSubmit(result);

    try {
      await this.conversations.putReadMarker(conversation.id, caller.user.id, {
        lastReadMessageSk: messageSk(now, message.id),
        at: now,
      });
    } catch (error) {
      this.logger.warn(`Read marker for ${caller.user.id} on ${conversation.id} not written: ${error instanceof Error ? error.message : error}`);
    }

    const recipients = teamRecipients(result.conversation, caller.user.id);
    this.logger.log(`In-app ${message.id} stored in ${conversation.id} (${conversation.kind}) for ${recipients.length} member(s)`);
    this.realtime?.messageUpserted(message, result.conversation, now, { recipients, mentions });
    // Badges (§6): every recipient's own team-chat badge is recounted on
    // their stream; when the employee's line marked the office's thread
    // unread, the company-wide counters are read back and pushed too.
    this.realtime?.teamCountersInvalidated(conversation.id, recipients, now);
    if (fromParty && countersDelta(conversation, result.conversation)) this.pushInboxCounters();
    // The `message.received` a notifier subscribes to (EVENTS.md): the
    // thread's party says whom to wake — the employee, or the group.
    void this.events.messageReceived(message, result.conversation);
    void this.events.conversationUpdated(conversation.id);
    return message;
  }

  /** The inbox badge after a write that moved `INBOX#COUNTERS`; never awaited on the request path. */
  private pushInboxCounters(): void {
    if (!this.inboxCounters || !this.realtime) return;
    void this.inboxCounters
      .get()
      .then((counters) => this.realtime?.countersChanged(counters))
      .catch((err) => this.logger.warn(`counters push failed: ${err instanceof Error ? err.message : err}`));
  }

  /** A repeated submit (double click, network retry): the first one won — hand it back (design §4.9). */
  private async firstSubmit(result: AppendResult): Promise<Message> {
    const first = result.existing
      ? await this.messages.getBySk(result.existing.conversationId, result.existing.messageSk)
      : null;
    if (!first) throw new HttpException('clientMessageId was already used', HttpStatus.CONFLICT);
    return first;
  }

  /**
   * Where an SMS goes. A client thread: one of the conversation's numbers
   * (`toAddress`, else the first). An employee's thread (design §6): their
   * personal phone as user-service has it now — 404 when the user is gone,
   * 422 `EMPLOYEE_HAS_NO_PHONE` when they have none — recorded on the
   * thread and pointed at it (`ADDR#`) so their reply routes straight back.
   * Without a directory wired (unit tests) the thread's own number is used.
   */
  private async smsTarget(
    conversation: Conversation,
    dto: SendMessageDto,
  ): Promise<{ to: string; conversation: Conversation; employee: boolean }> {
    if (conversation.partyKind !== 'user' || !conversation.partyId || !this.users) {
      return { to: this.recipient(conversation, dto.toAddress), conversation, employee: conversation.partyKind === 'user' };
    }
    const teammate = await this.users.find(conversation.partyId);
    if (!teammate) throw new NotFoundException(`User ${conversation.partyId} not found`);
    const phone = teammate.phone ? tryNormalizePhone(teammate.phone) : undefined;
    if (!phone) throw new EmployeeHasNoPhoneException(conversation.partyId);
    if (dto.toAddress && tryNormalizePhone(dto.toAddress) !== phone) {
      throw new BadRequestException("toAddress must be the employee's personal phone");
    }
    return { to: phone, conversation: await this.adoptPhone(conversation, phone), employee: true };
  }

  /** The employee's current number onto the thread + `ADDR#` — tolerant of a concurrent write. */
  private async adoptPhone(conversation: Conversation, phone: string): Promise<Conversation> {
    const now = new Date().toISOString();
    if (conversation.addresses.phones.includes(phone)) return conversation;
    await this.conversations.putAddressPointer({
      address: phone,
      conversationId: conversation.id,
      partyKind: 'user',
      partyId: conversation.partyId,
      source: 'crm',
      updatedAt: now,
    });
    try {
      return await this.conversations.update(
        conversation,
        { addresses: { ...conversation.addresses, phones: [phone, ...conversation.addresses.phones] } },
        { at: now },
      );
    } catch (error) {
      if (!(error instanceof StaleConversationError)) throw error;
      return (await this.conversations.get(conversation.id)) ?? conversation;
    }
  }

  /** The author's display name for the feed; a directory hiccup costs the name, never the send. */
  private async senderName(userId: string): Promise<string | undefined> {
    if (!this.users) return undefined;
    try {
      return (await this.users.find(userId))?.name;
    } catch {
      return undefined;
    }
  }

  /**
   * `messages.send` is checked by the guard. A team / group thread
   * additionally needs `team_chat.send` and the `team_chat` data scope
   * (design §7.1, §7.5): a technician writes only in their own thread and
   * their groups. A client thread under an `assigned_only` `messages` scope
   * is limited to conversations of jobs the caller is on — verified against
   * the job's roster, and refused when the roster cannot be read.
   */
  private async authorise(conversation: Conversation, dto: SendMessageDto, caller: SendCaller): Promise<void> {
    const { user, perms } = caller;
    if (isTeamKind(conversation.kind)) {
      if (!hasPermission(perms, 'team_chat', 'send')) {
        throw new ForbiddenException('Missing permission: team_chat.send');
      }
      if (!perms) return;
      if (!this.teamAccess.canAccess(conversation, this.teamAccess.scopeFor(user, perms))) {
        throw new ForbiddenException('You can only write in your own team thread and your groups');
      }
      return;
    }
    if (!perms) return;

    const scope = getDataScopeFilter(user, 'messages', perms);
    if (scope.scope === DataScope.ASSIGNED_ONLY) {
      const dealId = dto.dealId ?? conversation.lastDealId;
      const deal = dealId ? await this.deals.find(dealId) : null;
      const onJob = !!deal && (deal.assignedTechIds.includes(user.id) || deal.assignedDispatcherId === user.id);
      if (!onJob) {
        throw new ForbiddenException('You can only message clients of jobs you are assigned to');
      }
    }
    // `department` scope: conversations carry no department; nothing to narrow by.
  }

  private recipient(conversation: Conversation, toAddress: string | undefined): string {
    const phones = conversation.addresses?.phones ?? [];
    if (toAddress) {
      const normalised = tryNormalizePhone(toAddress);
      if (!normalised || !phones.includes(normalised)) {
        throw new BadRequestException('toAddress is not one of the conversation phone numbers');
      }
      return normalised;
    }
    if (!phones.length) throw new BadRequestException('The conversation has no phone number to text');
    return phones[0];
  }

  private async renderBody(conversation: Conversation, dto: SendMessageDto): Promise<string> {
    let body = dto.body?.trim() ?? '';
    if (dto.templateId && this.templates) {
      const rendered = await this.templates.render({
        templateId: dto.templateId,
        channel: dto.channel,
        conversationId: conversation.id,
        partyKind: conversation.partyKind,
        partyId: conversation.partyId,
        dealId: dto.dealId ?? conversation.lastDealId,
        body,
      });
      if (rendered?.body) body = rendered.body.trim();
    }
    if (!body) throw new BadRequestException('body must not be blank');
    return body;
  }

  private attachments(dtos: SendAttachmentDto[] | undefined, userId: string): MessageAttachment[] | undefined {
    if (!dtos?.length) return undefined;
    const total = dtos.reduce((sum, a) => sum + a.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Attachments must total at most 5 MB per message');
    }
    return dtos.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      size: a.size,
      status: 'stored',
      s3Key: uploadKey(userId, a.id),
    }));
  }

  // ---------------------------------------------- POST /messages: the party

  /** The contact's thread, opened from CRM when there is none yet — also what the automations text a client through. */
  async conversationForContact(contactId: string, phone?: string): Promise<FoundConversation> {
    const existing = await this.conversations.getByParty('contact', contactId);
    if (existing) return { conversation: existing, created: false };

    const contact = await this.crm.getContact(contactId);
    if (!contact) throw new NotFoundException('Contact not found');
    const phones = contact.phones.map(tryNormalizePhone).filter((p): p is string => !!p);
    if (phone && !phones.includes(normalizePhone(phone))) {
      throw new BadRequestException('phone is not one of the contact phone numbers');
    }
    return this.createConversation({
      kind: 'client',
      partyKind: 'contact',
      partyId: contactId,
      pointer: { kind: 'contact', id: contactId },
      phones,
      emails: contact.emails,
      addressSource: 'crm',
    });
  }

  private async conversationForPhone(phone: string): Promise<FoundConversation> {
    const pointer = await this.conversations.getByAddress(phone);
    if (pointer) {
      const routed = await this.conversations.get(pointer.conversationId);
      if (routed) return { conversation: routed, created: false };
    }

    const owner = await this.crm.findByPhone(phone);
    if (owner) {
      const existing = await this.conversations.getByParty(owner.kind, owner.id);
      if (existing) return { conversation: existing, created: false };
      const contact = owner.kind === 'contact' ? await this.crm.getContact(owner.id) : null;
      const phones = new Set([phone, ...(contact?.phones ?? []).map(tryNormalizePhone).filter((p): p is string => !!p)]);
      return this.createConversation({
        kind: 'client',
        partyKind: owner.kind,
        partyId: owner.id,
        pointer: { kind: owner.kind, id: owner.id },
        phones: [...phones],
        emails: contact?.emails ?? [],
        addressSource: 'crm',
      });
    }

    // Nobody in CRM owns the number: an `unknown` thread keyed by the address,
    // exactly what an inbound text from it would open (design §4.3).
    return this.createConversation({
      kind: 'unknown',
      partyKind: 'none',
      pointer: { kind: 'address', id: phone },
      phones: [phone],
      emails: [],
      addressSource: 'manual',
    });
  }

  private async createConversation(input: {
    kind: ConversationKind;
    partyKind: Conversation['partyKind'];
    partyId?: string;
    pointer: { kind: 'contact' | 'company' | 'address'; id: string };
    phones: string[];
    emails: string[];
    addressSource: 'crm' | 'manual';
  }): Promise<FoundConversation> {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      kind: input.kind,
      partyKind: input.partyKind,
      partyId: input.partyId,
      addresses: { phones: input.phones, emails: input.emails },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      createdAt: now,
      updatedAt: now,
    };
    return this.conversations.findOrCreate({
      conversation,
      pointer: input.pointer,
      addresses: input.phones.map((address) => ({ address, source: input.addressSource })),
    });
  }
}
