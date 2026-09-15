import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type MessageInstance } from 'twilio/lib/rest/api/v2010/account/message';
import { SnsPublisherService, TwilioRest, tryNormalizePhone } from '@bitcrm/shared';
import {
  MESSAGE_EVENT_TOPIC,
  MESSAGE_STATUSES,
  MESSAGE_STATUS_RANK,
  MessageEventType,
  isSmsChannel,
  isTerminalMessageStatus,
  type ConversationUpdatedEvent,
  type Message,
  type MessageAttachment,
  type MessageStatus,
  type MessageStatusChangedEvent,
} from '@bitcrm/types';
import { parseMessageSk } from '../common/constants/dynamo.constants';
import { InboundService } from '../inbound/inbound.service';
import { mediaFileName, type InboundMedia, type InboundMessageInput } from '../inbound/twilio-inbound.payload';
import { MediaQueueService } from '../media/media-queue.service';
import {
  MessagesRepository,
  type MessageKey,
  type ProviderSidPointer,
  type StatusUpdate,
} from '../messages/messages.repository';
import { describeTwilioError, mapTwilioStatus } from '../outbound/twilio-error.map';
import { RealtimePublisher } from '../realtime/realtime.publisher';

export interface ReconcileWindow {
  /** ISO-8601; default 90 minutes before `until`. */
  since?: string;
  /** ISO-8601; default now. */
  until?: string;
  /** Cap on Twilio records read. */
  limit?: number;
}

export interface ReconcileReport {
  since: string;
  until: string;
  /** Twilio records in the window. */
  scanned: number;
  /** Already known by `PSID#` and at least as far along as Twilio says — the normal case. */
  skipped: number;
  /**
   * Known by `PSID#` but Twilio's status outranked ours (a status callback
   * never arrived): the status was written as the callback would have.
   */
  synced: number;
  inbound: { inserted: number; duplicates: number };
  outbound: {
    inserted: number;
    /** An outbound line we had without a sid (worker died mid-send) now carries it. */
    adopted: number;
    duplicates: number;
  };
  failed: number;
  errors: Array<{ sid: string; error: string }>;
}

/** The hourly run looks back further than an hour so a slow webhook retry is never missed. */
export const DEFAULT_LOOKBACK_MS = 90 * 60_000;
/** How far apart an unclaimed outbound line and Twilio's record may be to count as the same send. */
const ADOPT_WINDOW_MS = 15 * 60_000;
/** How many recent lines of a conversation are inspected for an unclaimed send. */
const ADOPT_SCAN_LIMIT = 50;
const TWILIO_PAGE_SIZE = 1000;

/** Twilio → BitCRM status (§3.2); statuses Twilio has and we do not fold into the nearest rank. */
const TWILIO_STATUS: Record<string, MessageStatus> = {
  accepted: 'queued',
  scheduled: 'queued',
  receiving: 'received',
  partially_delivered: 'delivered',
};

export function fromTwilioStatus(status: string | undefined): MessageStatus {
  if (!status) return 'queued';
  if (TWILIO_STATUS[status]) return TWILIO_STATUS[status];
  return (MESSAGE_STATUSES as readonly string[]).includes(status) ? (status as MessageStatus) : 'queued';
}

/** What `syncMessage` found (and the hourly run counts under `synced` / `skipped`). */
export type MessageSyncOutcome =
  /** Twilio's status outranked ours and was written. */
  | 'synced'
  /** Nothing newer at Twilio (or a callback got there first). */
  | 'unchanged'
  /** No such message. */
  | 'not_found'
  /** Not at Twilio yet — a `queued` line the worker has not sent, or one that died before the sid was recorded. */
  | 'no_provider_sid'
  /** Not an outbound Twilio SMS of this account (inbound, email, in-app, imported history). */
  | 'not_syncable';

export interface MessageSyncResult {
  outcome: MessageSyncOutcome;
  /** The line as it is after the call (absent on `not_found`). */
  message?: Message;
  /** Twilio's raw status when it was fetched. */
  providerStatus?: string;
}

/**
 * Reconciliation with Twilio's message log (design M8, §4.9): list the
 * account's messages for a window, both directions, and insert what is
 * missing by SID. The webhook and the send worker are the primary paths;
 * this is the safety net for a lost webhook, a fallback capture that never
 * replayed, or a worker that died between `messages.create` and the `PSID#`
 * write. Every write is keyed by the Twilio SID (`PSID#`, `CLIENTMSG#reconcile:<sid>`),
 * so running it twice over the same window changes nothing.
 *
 *   inbound  → the webhook pipeline without the signature (`InboundService.ingest`,
 *              `receivedAt` = Twilio's `dateSent` so the line lands in its
 *              historical place; MMS media are listed and queued for copy);
 *   outbound → first an "adopt": an outbound line in the recipient's conversation
 *              with the same body and no sid within ±15 min gets the sid and
 *              Twilio's status; otherwise a new line (`origin: system`) with
 *              Twilio's status, in the conversation the recipient resolves to;
 *   known    → an outbound line that already carries the sid is compared with
 *              Twilio's status: when Twilio is further along (`delivered`,
 *              `failed 21408`…) and the status callback never made it — a
 *              developer machine Twilio cannot reach, a lost webhook — the
 *              status is written exactly as the callback would have written it
 *              (rank guard, error text, `message.status_changed`, realtime).
 *
 * `syncMessage` is the same comparison for one line, fetching its sid from
 * Twilio: the internal `POST /internal/reconcile/message` and the opt-in
 * in-process poller (`StatusSyncPoller`) both go through it.
 */
@Injectable()
export class ReconcileService {
  private readonly logger = new Logger(ReconcileService.name);

  constructor(
    private readonly twilioRest: TwilioRest,
    private readonly inbound: InboundService,
    private readonly messages: MessagesRepository,
    private readonly mediaQueue: MediaQueueService,
    @Optional() private readonly snsPublisher?: SnsPublisherService,
    @Optional() private readonly realtime?: RealtimePublisher,
  ) {}

  async run(window: ReconcileWindow = {}, now: Date = new Date()): Promise<ReconcileReport> {
    const until = window.until ? new Date(window.until) : now;
    const since = window.since ? new Date(window.since) : new Date(until.getTime() - DEFAULT_LOOKBACK_MS);
    if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
      throw new Error(`Invalid reconciliation window ${window.since} → ${window.until}`);
    }
    const at = now.toISOString();
    const report: ReconcileReport = {
      since: since.toISOString(),
      until: until.toISOString(),
      scanned: 0,
      skipped: 0,
      synced: 0,
      inbound: { inserted: 0, duplicates: 0 },
      outbound: { inserted: 0, adopted: 0, duplicates: 0 },
      failed: 0,
      errors: [],
    };

    const records = await this.twilioRest.run((client) =>
      client.messages.list({
        dateSentAfter: since,
        dateSentBefore: until,
        pageSize: TWILIO_PAGE_SIZE,
        ...(window.limit && { limit: window.limit }),
      }),
    );
    // Oldest first, so a conversation's last* rolls forward naturally.
    records.sort((a, b) => sentAt(a).localeCompare(sentAt(b)));
    report.scanned = records.length;
    this.logger.log(`Reconciling ${records.length} Twilio messages ${report.since} → ${report.until}`);

    for (const record of records) {
      if (!record.sid) continue;
      try {
        const pointer = await this.messages.getProviderSidPointer(record.sid);
        if (pointer) {
          report[await this.syncKnown(pointer, record, at)]++;
          continue;
        }
        if (record.direction === 'inbound') {
          const outcome = await this.reconcileInbound(record);
          report.inbound[outcome === 'stored' ? 'inserted' : 'duplicates']++;
        } else {
          const outcome = await this.reconcileOutbound(record, at);
          report.outbound[outcome]++;
        }
      } catch (error) {
        report.failed++;
        const message = error instanceof Error ? error.message : String(error);
        report.errors.push({ sid: record.sid, error: message });
        this.logger.error(`Reconciling ${record.sid} failed: ${message}`);
      }
    }

    this.logger.log(
      `Reconciled: ${report.scanned} scanned, ${report.skipped} known, ${report.synced} status-synced, ` +
        `${report.inbound.inserted} inbound + ${report.outbound.inserted} outbound inserted, ` +
        `${report.outbound.adopted} adopted, ${report.failed} failed`,
    );
    return report;
  }

  // ------------------------------------------------------------ status sync

  /**
   * One outbound line against Twilio (`messages(sid).fetch()`): the targeted
   * form of the known-sid step of `run`, for the internal route and the
   * in-process poller. A line already at a terminal rank (or `read`) is not
   * looked up — Twilio has nothing newer to say about it.
   */
  async syncMessage(key: MessageKey, now: Date = new Date()): Promise<MessageSyncResult> {
    const message = await this.messages.get(key);
    if (!message) return { outcome: 'not_found' };
    if (!this.isSyncable(message)) return { outcome: 'not_syncable', message };
    if (!message.providerSid) return { outcome: 'no_provider_sid', message };
    if (MESSAGE_STATUS_RANK[message.status] >= MESSAGE_STATUS_RANK.delivered) return { outcome: 'unchanged', message };

    const sid = message.providerSid;
    const record = await this.twilioRest.run((client) => client.messages(sid).fetch());
    return this.applyProviderStatus(message, key, record, now.toISOString());
  }

  /**
   * The known-sid step of `run`: Twilio's record for a line we already have.
   * Inbound records never change; an outbound one is read only when Twilio's
   * status could outrank anything a sent line holds (`sent` and up), so the
   * normal case — everything delivered and known — costs one read per record.
   */
  private async syncKnown(pointer: ProviderSidPointer, record: MessageInstance, at: string): Promise<'synced' | 'skipped'> {
    if (record.direction === 'inbound') return 'skipped';
    const mapped = mapTwilioStatus(record.status);
    if (!mapped || MESSAGE_STATUS_RANK[mapped] <= MESSAGE_STATUS_RANK.sending) return 'skipped';

    const message = await this.messages.getBySk(pointer.conversationId, pointer.messageSk);
    if (!message || !this.isSyncable(message)) return 'skipped';
    const key: MessageKey = { conversationId: pointer.conversationId, ...parseMessageSk(pointer.messageSk) };
    const result = await this.applyProviderStatus(message, key, record, at);
    return result.outcome === 'synced' ? 'synced' : 'skipped';
  }

  /** An outbound Twilio SMS of this account — what a status callback could have updated. */
  private isSyncable(message: Message): boolean {
    return (
      message.direction === 'outbound' &&
      isSmsChannel(message.channel) &&
      (message.provider ?? 'twilio') === 'twilio' &&
      !message.providerAccount
    );
  }

  /**
   * Twilio's record against the stored line: when the mapped status outranks
   * ours, write it under the same rank + sid guard the status callback uses
   * (`StatusCallbackService`), with the error text `describeTwilioError`
   * gives, and tell the same listeners — `message.status_changed` on a
   * terminal status, `conversation.updated`, and the browsers over realtime.
   */
  private async applyProviderStatus(
    message: Message,
    key: MessageKey,
    record: Pick<MessageInstance, 'sid' | 'status' | 'errorCode' | 'errorMessage' | 'numSegments' | 'dateSent' | 'dateUpdated'>,
    at: string,
  ): Promise<MessageSyncResult> {
    const providerStatus = record.status;
    const status = mapTwilioStatus(providerStatus);
    if (!status || MESSAGE_STATUS_RANK[status] <= MESSAGE_STATUS_RANK[message.status]) {
      return { outcome: 'unchanged', message, providerStatus };
    }

    const errorCode = record.errorCode ? String(record.errorCode) : undefined;
    const update: StatusUpdate = {
      status,
      providerSid: record.sid,
      errorCode,
      errorMessage: errorCode ? describeTwilioError(errorCode, record.errorMessage) : undefined,
      segments: Number(record.numSegments) || undefined,
      sentAt: record.dateSent?.toISOString(),
      deliveredAt: status === 'delivered' ? record.dateUpdated?.toISOString() : undefined,
      at,
    };
    const applied = await this.messages.updateStatus(key, update);
    if (!applied) {
      // A callback (or another instance) got there first: the rank guard kept its write.
      this.logger.debug(`Status ${status} from Twilio for ${record.sid} ignored (already at least there)`);
      return { outcome: 'unchanged', message, providerStatus };
    }

    const updated: Message = {
      ...message,
      status,
      providerSid: record.sid,
      errorCode: errorCode ?? message.errorCode,
      errorMessage: update.errorMessage ?? message.errorMessage,
      segments: update.segments ?? message.segments,
      sentAt: update.sentAt ?? message.sentAt ?? (status === 'sent' ? at : undefined),
      deliveredAt: update.deliveredAt ?? message.deliveredAt ?? (status === 'delivered' ? at : undefined),
      updatedAt: at,
    };
    this.logger.log(`Synced ${record.sid} (${key.conversationId}/${key.messageId}) ${message.status} → ${status}${errorCode ? ` ${errorCode}` : ''} from Twilio`);
    if (isTerminalMessageStatus(status)) this.announceStatus(key, status, errorCode);
    this.announce(key.conversationId);
    this.realtime?.messageUpserted(updated, undefined, at);
    return { outcome: 'synced', message: updated, providerStatus };
  }

  /** `message.status_changed`, as the status callback publishes it (EVENTS.md). */
  private announceStatus(key: MessageKey, status: MessageStatus, errorCode: string | undefined): void {
    const payload: MessageStatusChangedEvent = {
      messageId: key.messageId,
      conversationId: key.conversationId,
      status,
      ...(errorCode ? { errorCode } : {}),
    };
    this.snsPublisher
      ?.publish<MessageStatusChangedEvent>(MESSAGE_EVENT_TOPIC, MessageEventType.MESSAGE_STATUS_CHANGED, payload)
      .catch((err) => this.logger.warn(`SNS publish message.status_changed failed: ${err instanceof Error ? err.message : err}`));
  }

  // --------------------------------------------------------------- inbound

  private async reconcileInbound(record: MessageInstance): Promise<'stored' | 'duplicate'> {
    const from = tryNormalizePhone(record.from ?? '');
    const to = tryNormalizePhone(record.to ?? '');
    if (!from || !to) throw new Error(`not a phone number pair: ${record.from} → ${record.to}`);

    const input: InboundMessageInput = {
      providerSid: record.sid,
      accountSid: record.accountSid,
      messagingServiceSid: record.messagingServiceSid ?? undefined,
      from,
      to,
      body: record.body?.trim() || undefined,
      segments: Number(record.numSegments) || undefined,
      media: Number(record.numMedia) > 0 ? await this.listMedia(record.sid) : [],
      receivedAt: sentAt(record),
    };
    const result = await this.inbound.ingest(input, { source: 'reconcile' });
    return result.outcome;
  }

  /** The media of a message, shaped like the webhook's `MediaUrl{N}` list. */
  private async listMedia(messageSid: string): Promise<InboundMedia[]> {
    const items = await this.twilioRest.run((client) => client.messages(messageSid).media.list());
    return items.map((m, index) => ({
      index,
      url: `https://api.twilio.com${m.uri.replace(/\.json$/, '')}`,
      contentType: m.contentType || 'application/octet-stream',
      providerMediaSid: m.sid,
    }));
  }

  // -------------------------------------------------------------- outbound

  private async reconcileOutbound(record: MessageInstance, at: string): Promise<'inserted' | 'adopted' | 'duplicates'> {
    const to = tryNormalizePhone(record.to ?? '');
    const from = tryNormalizePhone(record.from ?? '');
    if (!to) throw new Error(`recipient is not a phone number: ${record.to}`);

    const status = fromTwilioStatus(record.status);
    const located = await this.inbound.locateConversation(to, at);
    const conversationId = located.conversation.id;

    const unclaimed = await this.findUnclaimed(conversationId, record, to);
    if (unclaimed) {
      const key: MessageKey = { conversationId, createdAt: unclaimed.createdAt, messageId: unclaimed.id };
      await this.messages.updateStatus(key, {
        status,
        providerSid: record.sid,
        errorCode: record.errorCode ? String(record.errorCode) : undefined,
        errorMessage: record.errorMessage ?? undefined,
        segments: Number(record.numSegments) || undefined,
        sentAt: record.dateSent?.toISOString(),
        at,
      });
      await this.messages.putProviderSidPointer(record.sid, key, at);
      this.logger.log(`Adopted ${record.sid} onto ${conversationId}/${unclaimed.id}`);
      this.announce(conversationId);
      return 'adopted';
    }

    const media = Number(record.numMedia) > 0 ? await this.listMedia(record.sid) : [];
    const attachments: MessageAttachment[] | undefined = media.length
      ? media.map((m) => ({
          id: randomUUID(),
          fileName: mediaFileName(m),
          contentType: m.contentType,
          status: 'pending',
          sourceUrl: m.url,
          providerMediaSid: m.providerMediaSid,
        }))
      : undefined;
    const createdAt = (record.dateCreated ?? record.dateSent ?? new Date(at)).toISOString();
    const message: Message = {
      id: randomUUID(),
      conversationId,
      channel: 'sms',
      direction: 'outbound',
      body: record.body?.trim() || undefined,
      from: from ?? record.from ?? undefined,
      to,
      businessNumber: from ?? undefined,
      contactAddress: to,
      status,
      errorCode: record.errorCode ? String(record.errorCode) : undefined,
      errorMessage: record.errorMessage ?? undefined,
      segments: Number(record.numSegments) || undefined,
      provider: 'twilio',
      providerSid: record.sid,
      origin: 'system',
      sentByName: 'Twilio (reconciled)',
      attachments,
      createdAt,
      sentAt: record.dateSent?.toISOString(),
      deliveredAt: status === 'delivered' ? record.dateUpdated?.toISOString() : undefined,
      updatedAt: at,
    };

    const appended = await this.messages.appendOutbound({
      message,
      clientMessageId: `reconcile:${record.sid}`,
      createdBy: 'reconcile',
      conversation: located.conversation,
      at,
    });
    let key: MessageKey = { conversationId, createdAt, messageId: message.id };
    if (appended.duplicate) {
      // A previous run wrote the line but died before the PSID# pointer.
      if (!appended.existing) throw new Error(`CLIENTMSG#reconcile:${record.sid} exists but cannot be read`);
      const parsed = parseMessageSk(appended.existing.messageSk);
      key = { conversationId: appended.existing.conversationId, ...parsed };
    }
    await this.messages.putProviderSidPointer(record.sid, key, at);

    if (!appended.duplicate && attachments) {
      await this.mediaQueue.enqueueMediaCopy({
        conversationId,
        messageId: message.id,
        createdAt,
        providerSid: record.sid,
        attachments: attachments.map((a) => ({
          id: a.id,
          sourceUrl: a.sourceUrl ?? '',
          contentType: a.contentType,
          providerMediaSid: a.providerMediaSid,
        })),
      });
    }
    this.logger.log(`${appended.duplicate ? 'Re-pointed' : 'Inserted'} outbound ${record.sid} in ${conversationId}`);
    this.announce(conversationId);
    return appended.duplicate ? 'duplicates' : 'inserted';
  }

  /**
   * §4.4: a send whose worker died after `messages.create` left a line with
   * `sending`/`queued` and no sid. Same recipient, same text, close in time
   * → that is this Twilio record.
   */
  private async findUnclaimed(conversationId: string, record: MessageInstance, to: string): Promise<Message | undefined> {
    const page = await this.messages.listByConversation(conversationId, { limit: ADOPT_SCAN_LIMIT });
    const reference = (record.dateCreated ?? record.dateSent)?.getTime();
    const body = record.body?.trim() ?? '';
    return page.items.find(
      (m) =>
        m.direction === 'outbound' &&
        !m.providerSid &&
        m.to === to &&
        (m.body?.trim() ?? '') === body &&
        (reference === undefined || Math.abs(new Date(m.createdAt).getTime() - reference) <= ADOPT_WINDOW_MS),
    );
  }

  private announce(conversationId: string): void {
    this.snsPublisher
      ?.publish<ConversationUpdatedEvent>(MESSAGE_EVENT_TOPIC, MessageEventType.CONVERSATION_UPDATED, { conversationId })
      .catch((err) => this.logger.warn(`SNS publish conversation.updated failed: ${err instanceof Error ? err.message : err}`));
  }
}

const sentAt = (record: MessageInstance): string =>
  (record.dateSent ?? record.dateCreated ?? new Date(0)).toISOString();
