import { Inject, Injectable, Logger } from '@nestjs/common';
import { TWILIO_CONFIG, type TwilioConfig } from '@bitcrm/shared';
import { type Conversation, type SenderSource } from '@bitcrm/types';
import { MessagingSettingsRepository } from '../settings/messaging-settings.repository';
import { DealContextClient } from './internal/deal-context.client';
import { TelephonyNumbersClient, type OwnedNumberInfo } from './internal/telephony-numbers.client';
import { OUTBOUND_CONFIG, type OutboundConfig } from './outbound.config';

export interface ResolvedSender {
  /** E.164 to pass as `From`; absent → the Messaging Service pool picks (`source: 'pool'`). */
  from?: string;
  source: SenderSource;
}

export interface ResolveSenderInput {
  /** `SendMessageDto.fromNumber` — the agent's pick in the composer. */
  requested?: string;
  conversation: Pick<Conversation, 'lastBusinessNumber'>;
  /** The job the message is about (`dto.dealId ?? conversation.lastDealId`). */
  dealId?: string;
}

/** A plausible E.164 — the same sanity filter telephony's `CallerIdResolver` uses. */
const looksE164 = (v: string | undefined): v is string => !!v && /^\+\d{6,15}$/.test(v);

/**
 * Which of our numbers the client sees a text from (design §4.2), the shape
 * of telephony's `CallerIdResolver`:
 *
 *   1. agent    the number picked in the composer
 *   2. sticky   `CONV#….lastBusinessNumber` — the number the client already knows
 *   3. called   the number of the last call with the contact  — TODO: needs
 *               telephony `GET /calls/by-party/contact/:id`; skipped for now
 *   4. area     the job's service-area caller id (deal-service internal)
 *   5. source   the tracking number of the job's source (`NUMSET#ALL.sourceId`)
 *   6. default  `MESSAGING#SETTINGS.defaultSenderNumber`, then `MESSAGING_DEFAULT_SENDER`
 *   7. pool     no `From`: Twilio's sticky sender / geomatch chooses
 *
 * Every candidate must be allowed: owned, SMS-capable and — when both sides
 * know it — pooled in the configured Messaging Service. A number the client
 * wrote to but we may not reply from is skipped, and the UI warns (§4.2).
 * When telephony cannot be reached the owned list is empty, which means
 * "unknown", not "we own nothing": candidates then pass unchecked and
 * Twilio is the one to refuse (21606), which the worker maps to `failed`.
 */
@Injectable()
export class SenderResolver {
  private readonly logger = new Logger(SenderResolver.name);

  constructor(
    private readonly numbers: TelephonyNumbersClient,
    private readonly deals: DealContextClient,
    private readonly settings: MessagingSettingsRepository,
    @Inject(TWILIO_CONFIG) private readonly twilio: Pick<TwilioConfig, 'messagingServiceSid'>,
    @Inject(OUTBOUND_CONFIG) private readonly config: Pick<OutboundConfig, 'defaultSender'>,
  ) {}

  async resolve(input: ResolveSenderInput): Promise<ResolvedSender> {
    const owned = await this.numbers.listOwned();
    const allowed = owned.length ? new Set(owned.filter((n) => this.isAllowed(n)).map((n) => n.phoneNumber)) : null;
    const deal = input.dealId ? await this.deals.find(input.dealId) : null;

    const rungs: Array<[SenderSource, () => Promise<string | undefined>]> = [
      ['agent', async () => input.requested],
      ['sticky', async () => input.conversation.lastBusinessNumber],
      ['area', () => this.deals.serviceAreaCallerId(deal?.serviceAreaId)],
      ['source', async () => this.sourceNumber(owned, deal?.sourceId)],
      ['default', () => this.defaultNumber()],
    ];

    for (const [source, pick] of rungs) {
      const candidate = await pick();
      if (!looksE164(candidate)) continue;
      if (allowed && !allowed.has(candidate)) {
        this.logger.warn(`sender ${candidate} (${source}) is not an SMS-ready workspace number — skipping`);
        continue;
      }
      return { from: candidate, source };
    }
    return { source: 'pool' };
  }

  /** The numbers the composer may offer (`GET /senders`): owned, SMS-capable, pooled. */
  async allowedNumbers(): Promise<OwnedNumberInfo[]> {
    return (await this.numbers.listOwned()).filter((n) => this.isAllowed(n));
  }

  private isAllowed(n: OwnedNumberInfo): boolean {
    if (!n.capabilities?.sms) return false;
    const pool = this.twilio.messagingServiceSid;
    if (pool && n.messagingServiceSid && n.messagingServiceSid !== pool) return false;
    return true;
  }

  private sourceNumber(owned: OwnedNumberInfo[], sourceId: string | undefined): string | undefined {
    if (!sourceId) return undefined;
    return owned.find((n) => n.sourceId === sourceId && this.isAllowed(n))?.phoneNumber;
  }

  private async defaultNumber(): Promise<string | undefined> {
    try {
      const settings = await this.settings.get();
      if (settings?.defaultSenderNumber) return settings.defaultSenderNumber;
    } catch (error) {
      this.logger.warn(`settings read failed: ${error instanceof Error ? error.message : error}`);
    }
    return this.config.defaultSender;
  }
}
