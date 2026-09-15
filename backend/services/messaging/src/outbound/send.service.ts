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
  type ResolvedPermissions,
} from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagesRepository, type MessageKey } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { MAX_ATTACHMENT_BYTES, type SendAttachmentDto, type SendMessageDto, type StartConversationMessageDto } from './dto/send-message.dto';
import { CrmContactsClient } from './internal/crm-contacts.client';
import { DealContextClient } from './internal/deal-context.client';
import { OutboundEventsPublisher } from './outbound-events';
import { OutboundQueueProducer } from './outbound-queue.producer';
import { SenderResolver } from './sender.resolver';
import { MESSAGE_TEMPLATE_RENDERER, type MessageTemplateRenderer } from './template-renderer';

/** Who is sending: the JWT user and what `PermissionGuard` resolved for them. */
export interface SendCaller {
  user: JwtUser;
  perms?: ResolvedPermissions;
}

/** Prefix of every composer upload; the key never leaves the caller's own folder. */
export const uploadKey = (userId: string, attachmentId: string) =>
  `messaging/uploads/${userId}/${attachmentId}`;

const TEAM_KINDS: ReadonlyArray<ConversationKind> = ['team', 'group'];

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

/**
 * The accept half of outbound SMS (design §4.4 steps 1–3): authorise,
 * refuse opted-out recipients, pick the sender, store the message as
 * `queued` under the `CLIENTMSG#` idempotency guard, and hand it to the
 * FIFO queue. The worker (`OutboundWorker`) does the Twilio call. Email and
 * in-app sending are later milestones (M16, M17) and answer 501 here.
 */
@Injectable()
export class SendService {
  private readonly logger = new Logger(SendService.name);

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
  ) {}

  /** `POST /conversations/:id/messages`. */
  async sendToConversation(conversationId: string, dto: SendMessageDto, caller: SendCaller): Promise<Message> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return this.send(conversation, dto, caller);
  }

  /** `POST /messages` — find or create the party's conversation first. */
  async sendToParty(dto: StartConversationMessageDto, caller: SendCaller): Promise<Message> {
    const conversation = await this.conversationFor(dto);
    const toAddress = dto.toAddress ?? dto.phone;
    return this.send(conversation, { ...dto, toAddress }, caller);
  }

  // ------------------------------------------------------------- the path

  private async send(conversation: Conversation, dto: SendMessageDto, caller: SendCaller): Promise<Message> {
    await this.authorise(conversation, dto, caller);

    if (dto.channel !== 'sms') {
      // TODO(M16 in_app, M17 email): route by channel once those exist.
      throw new NotImplementedException(`Sending over ${dto.channel} is not available yet`);
    }

    const to = this.recipient(conversation, dto.toAddress);
    if (await this.optOuts.isOptedOut('sms', to)) throw new RecipientOptedOutException(to);

    const body = await this.renderBody(conversation, dto);
    const attachments = this.attachments(dto.attachments, caller.user.id);
    const dealId = dto.dealId ?? conversation.lastDealId;
    const sender = await this.sender.resolve({ requested: dto.fromNumber, conversation, dealId });

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

    const result = await this.messages.appendOutbound({
      message,
      clientMessageId: dto.clientMessageId,
      createdBy: caller.user.id,
      conversation,
      at: now,
    });
    if (result.duplicate) {
      // A repeated submit (double click, network retry): the first one won —
      // hand it back rather than sending twice (design §4.9).
      const first = result.existing
        ? await this.messages.getBySk(result.existing.conversationId, result.existing.messageSk)
        : null;
      if (!first) {
        throw new HttpException('clientMessageId was already used', HttpStatus.CONFLICT);
      }
      return first;
    }

    const key: MessageKey = { conversationId: conversation.id, createdAt: now, messageId: message.id };
    try {
      const outcome = await this.queue.enqueue(key);
      this.logger.log(`Accepted ${message.id} for ${to} via ${sender.source} (${outcome})`);
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

    void this.events.conversationUpdated(conversation.id);
    return message;
  }

  /**
   * `messages.send` is checked by the guard; team threads additionally need
   * `team_chat.send` (design §7.1), and an `assigned_only` data scope limits
   * a technician to conversations of jobs they are on — verified against
   * the job's roster, and refused when the roster cannot be read.
   */
  private async authorise(conversation: Conversation, dto: SendMessageDto, caller: SendCaller): Promise<void> {
    const { user, perms } = caller;
    if (TEAM_KINDS.includes(conversation.kind) && !hasPermission(perms, 'team_chat', 'send')) {
      throw new ForbiddenException('Missing permission: team_chat.send');
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

  private async conversationFor(dto: StartConversationMessageDto): Promise<Conversation> {
    if (dto.contactId) return this.conversationForContact(dto.contactId, dto.phone);
    if (dto.phone) return this.conversationForPhone(normalizePhone(dto.phone));
    throw new BadRequestException('contactId or phone is required');
  }

  private async conversationForContact(contactId: string, phone: string | undefined): Promise<Conversation> {
    const existing = await this.conversations.getByParty('contact', contactId);
    if (existing) return existing;

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

  private async conversationForPhone(phone: string): Promise<Conversation> {
    const pointer = await this.conversations.getByAddress(phone);
    if (pointer) {
      const routed = await this.conversations.get(pointer.conversationId);
      if (routed) return routed;
    }

    const owner = await this.crm.findByPhone(phone);
    if (owner) {
      const existing = await this.conversations.getByParty(owner.kind, owner.id);
      if (existing) return existing;
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
  }): Promise<Conversation> {
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
    const { conversation: stored } = await this.conversations.findOrCreate({
      conversation,
      pointer: input.pointer,
      addresses: input.phones.map((address) => ({ address, source: input.addressSource })),
    });
    return stored;
  }
}
