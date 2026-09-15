import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  BusinessMetricsService,
  SnsPublisherService,
  TWILIO_CONFIG,
  type TwilioConfig,
} from '@bitcrm/shared';
import {
  MESSAGE_EVENT_TOPIC,
  MessageEventType,
  type Conversation,
  type ConversationUpdatedEvent,
  type Message,
  type MessageAttachment,
  type MessageReceivedEvent,
  type OptOutChangedEvent,
  type OptOutStatus,
} from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { MessagesRepository } from '../messages/messages.repository';
import { OptOutsRepository } from '../opt-outs/opt-outs.repository';
import { MediaQueueService } from '../media/media-queue.service';
import { RealtimePublisher } from '../realtime/realtime.publisher';
import { PartyResolver, type ResolvedParty } from './party-resolver';
import { mediaFileName, type InboundMessageInput } from './twilio-inbound.payload';

/** Where the message came in through — for logs and metrics, not for the item. */
export type IngestSource = 'webhook' | 'fallback' | 'reconcile';

export interface IngestOptions {
  source: IngestSource;
  /** Injectable clock. */
  at?: string;
}

export interface IngestResult {
  outcome: 'stored' | 'duplicate';
  conversationId: string;
  messageId?: string;
  conversationCreated: boolean;
  /** How many media copy jobs were queued (0 when there is no media or no queue). */
  mediaQueued: number;
  optOut?: OptOutStatus;
}

/** A conversation for an address, plus whether it was created by this call. */
export interface LocatedConversation {
  conversation: Conversation;
  created: boolean;
  party?: ResolvedParty;
}

/**
 * The inbound SMS/MMS pipeline (design §4.3), shared by the signed webhook,
 * the fallback replay and the reconciliation:
 *
 *   1. the `AccountSid` must be ours (403 otherwise);
 *   2. `PSID#<MessageSid>` already written → duplicate, nothing else runs;
 *   3. party: `ADDR#` → user → CRM → unknown (`PartyResolver`);
 *   4. conversation: `CONVOF#<kind>#<id>` find-or-create, `ADDR#` (re)pointed;
 *   5. one `appendInbound` transaction (message + PSID# + conversation roll-forward + counters);
 *   6. `OptOutType` STOP/START → `OPTOUT#sms#<From>` (+ `opt_out.changed`);
 *   7. `NumMedia > 0` → a copy job on the media queue, attachments `pending`;
 *   8. `message.received` + `conversation.updated` on SNS, fire-and-forget.
 *
 * Steps 6–8 run after the message is durable and never fail the request:
 * Twilio has to get its 200 and a retry would be a duplicate at step 2.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    @Inject(TWILIO_CONFIG) private readonly config: Pick<TwilioConfig, 'accountSid'>,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly optOuts: OptOutsRepository,
    private readonly parties: PartyResolver,
    private readonly mediaQueue: MediaQueueService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly businessMetrics?: BusinessMetricsService,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  async ingest(input: InboundMessageInput, opts: IngestOptions): Promise<IngestResult> {
    if (this.config.accountSid && input.accountSid && input.accountSid !== this.config.accountSid) {
      this.logger.warn(`Inbound ${input.providerSid} from foreign account ${input.accountSid} rejected`);
      throw new ForbiddenException('Message belongs to another Twilio account');
    }

    // Cheap first line: most retries never reach the transaction.
    const seen = await this.messages.getProviderSidPointer(input.providerSid);
    if (seen) {
      this.logger.log(`Inbound ${input.providerSid} already stored (${opts.source})`);
      return { outcome: 'duplicate', conversationId: seen.conversationId, conversationCreated: false, mediaQueued: 0 };
    }

    const at = opts.at ?? new Date().toISOString();
    const located = await this.locateConversation(input.from, at);
    const message = this.buildMessage(input, located, at);

    const appended = await this.messages.appendInbound({ message, conversation: located.conversation, at });
    if (appended.duplicate) {
      return {
        outcome: 'duplicate',
        conversationId: located.conversation.id,
        conversationCreated: located.created,
        mediaQueued: 0,
      };
    }
    this.businessMetrics?.entityCreated.inc({ entity_type: 'message' });
    if (located.created) this.businessMetrics?.entityCreated.inc({ entity_type: 'conversation' });
    this.logger.log(
      `Inbound ${input.providerSid} → conversation ${located.conversation.id} (${located.conversation.kind}, ${opts.source})`,
    );

    const optOut = await this.recordOptOut(input, at);
    const mediaQueued = await this.queueMedia(message, input);

    // Step 8 (design §4.3): the browsers learn about it now, unmasked; the SSE side filters per viewer.
    this.realtime?.messageUpserted(message, appended.conversation, at);

    this.publish<MessageReceivedEvent>(MessageEventType.MESSAGE_RECEIVED, {
      messageId: message.id,
      conversationId: message.conversationId,
      channel: message.channel,
      from: message.from,
      to: message.to,
      partyKind: located.conversation.partyKind,
      partyId: located.conversation.partyId,
      dealId: message.dealId,
      providerSid: message.providerSid,
      createdAt: message.createdAt,
    });
    this.publish<ConversationUpdatedEvent>(MessageEventType.CONVERSATION_UPDATED, {
      conversationId: message.conversationId,
    });

    return {
      outcome: 'stored',
      conversationId: message.conversationId,
      messageId: message.id,
      conversationCreated: located.created,
      mediaQueued,
      optOut,
    };
  }

  /**
   * The conversation an address belongs to (§4.3 step 4), creating it when
   * needed. Also what the reconciliation uses to place an outbound line it
   * only knows the recipient of.
   */
  async locateConversation(address: string, at: string = new Date().toISOString()): Promise<LocatedConversation> {
    let resolution = await this.parties.resolve(address);

    if (resolution.conversationId) {
      const pointed = await this.conversations.get(resolution.conversationId);
      if (pointed) return { conversation: pointed, created: false, party: resolution.party };
      this.logger.warn(`ADDR#${address} points at missing conversation ${resolution.conversationId}; re-resolving`);
      if (!resolution.party) resolution = await this.parties.lookup(address);
    }

    const party = resolution.party;
    if (party) {
      const { conversation, created } = await this.conversations.findOrCreate({
        conversation: this.newConversation(address, at, party),
        pointer: { kind: party.kind, id: party.id },
        addresses: [{ address, source: 'crm' }],
      });
      if (created) return { conversation, created, party };
      return { conversation: await this.adoptAddress(conversation, address, at), created: false, party };
    }

    const { conversation, created } = await this.conversations.findOrCreate({
      conversation: this.newConversation(address, at, undefined, resolution.degraded),
      pointer: { kind: 'address', id: address },
    });
    if (created) return { conversation, created };
    return { conversation: await this.syncNeedsResolution(conversation, resolution.degraded, at), created: false };
  }

  // -------------------------------------------------------------- internals

  private newConversation(
    address: string,
    at: string,
    party?: ResolvedParty,
    needsResolution = false,
  ): Conversation {
    return {
      id: randomUUID(),
      kind: party ? (party.kind === 'user' ? 'team' : 'client') : 'unknown',
      partyKind: party?.kind ?? 'none',
      partyId: party?.id,
      addresses: { phones: [address], emails: [] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      needsResolution: needsResolution || undefined,
      createdAt: at,
      updatedAt: at,
    };
  }

  /**
   * An existing party conversation reached from a number it has not used
   * before (a second phone on the contact): record the address on the
   * conversation and point `ADDR#` at it so the next text skips the CRM.
   */
  private async adoptAddress(conversation: Conversation, address: string, at: string): Promise<Conversation> {
    await this.conversations.putAddressPointer({
      address,
      conversationId: conversation.id,
      partyKind: conversation.partyKind,
      partyId: conversation.partyId,
      source: 'crm',
      updatedAt: at,
    });
    if (conversation.addresses.phones.includes(address)) return conversation;
    return this.conversations.update(
      conversation,
      { addresses: { ...conversation.addresses, phones: [...conversation.addresses.phones, address] } },
      { at },
    );
  }

  /** Keep `needsResolution` honest on an existing unknown conversation. */
  private async syncNeedsResolution(conversation: Conversation, degraded: boolean, at: string): Promise<Conversation> {
    const flagged = conversation.needsResolution === true;
    if (flagged === degraded) return conversation;
    return this.conversations.update(conversation, { needsResolution: degraded ? true : null }, { at });
  }

  private buildMessage(input: InboundMessageInput, located: LocatedConversation, at: string): Message {
    const attachments: MessageAttachment[] | undefined = input.media.length
      ? input.media.map((m) => ({
          id: randomUUID(),
          fileName: mediaFileName(m),
          contentType: m.contentType,
          status: 'pending',
          sourceUrl: m.url,
          providerMediaSid: m.providerMediaSid,
        }))
      : undefined;
    const createdAt = input.receivedAt ?? at;
    return {
      id: randomUUID(),
      conversationId: located.conversation.id,
      channel: 'sms',
      direction: 'inbound',
      body: input.body,
      from: input.from,
      to: input.to,
      businessNumber: input.to,
      contactAddress: input.from,
      status: 'received',
      segments: input.segments,
      provider: 'twilio',
      providerSid: input.providerSid,
      origin: located.conversation.partyKind === 'user' ? 'employee' : 'contact',
      attachments,
      createdAt,
      updatedAt: at,
    };
  }

  /**
   * Advanced Opt-Out already answered the sender; we only keep our own
   * ledger current (§4.7). HELP changes nothing. A failure here is logged —
   * the message is stored and Twilio's own list still blocks sends.
   */
  private async recordOptOut(input: InboundMessageInput, at: string): Promise<OptOutStatus | undefined> {
    const status: OptOutStatus | undefined =
      input.optOutType === 'STOP' ? 'opted_out' : input.optOutType === 'START' ? 'opted_in' : undefined;
    if (!status) return undefined;
    try {
      await this.optOuts.setStatus({
        channel: 'sms',
        address: input.from,
        status,
        source: 'advanced_opt_out',
        keyword: input.body?.trim().toUpperCase().slice(0, 32) || input.optOutType,
        messagingServiceSid: input.messagingServiceSid,
        at,
      });
      this.publish<OptOutChangedEvent>(MessageEventType.OPT_OUT_CHANGED, {
        channel: 'sms',
        address: input.from,
        status,
        source: 'advanced_opt_out',
      });
      return status;
    } catch (error) {
      this.logger.error(
        `Opt-out ${status} for ${input.from} not recorded: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }

  private async queueMedia(message: Message, input: InboundMessageInput): Promise<number> {
    if (!message.attachments?.length) return 0;
    try {
      const queued = await this.mediaQueue.enqueueMediaCopy({
        conversationId: message.conversationId,
        messageId: message.id,
        createdAt: message.createdAt,
        providerSid: input.providerSid,
        attachments: message.attachments.map((a) => ({
          id: a.id,
          sourceUrl: a.sourceUrl ?? '',
          contentType: a.contentType,
          providerMediaSid: a.providerMediaSid,
        })),
      });
      return queued ? message.attachments.length : 0;
    } catch (error) {
      this.logger.error(
        `Media copy for ${input.providerSid} not queued: ${error instanceof Error ? error.message : error}`,
      );
      return 0;
    }
  }

  /** Fire-and-forget SNS publish — event failures never fail an inbound write. */
  private publish<T>(eventType: string, payload: T): void {
    this.snsPublisher
      ?.publish(MESSAGE_EVENT_TOPIC, eventType, payload)
      .then(() => this.businessMetrics?.eventsPublished.inc({ event_type: eventType }))
      .catch((err) => {
        this.businessMetrics?.eventsFailed.inc({ event_type: eventType });
        this.logger.warn(`SNS publish ${eventType} failed: ${err instanceof Error ? err.message : err}`);
      });
  }
}
