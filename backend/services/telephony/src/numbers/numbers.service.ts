import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { type Twilio } from 'twilio';
import { TwilioRest } from '@bitcrm/shared';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string | null;
}

export interface OwnedNumberCapabilities {
  sms: boolean;
  mms: boolean;
  voice: boolean;
}

/** `OwnedNumber` plus what the messaging side needs to pick a sender. */
export interface OwnedNumberDetails extends OwnedNumber {
  smsUrl?: string | null;
  capabilities: OwnedNumberCapabilities;
}

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
  locality?: string | null;
  region?: string | null;
  /** Monthly recurring price, e.g. "1.15". */
  price?: string;
  /** Currency, e.g. "USD". */
  priceUnit?: string;
}

export interface SearchParams {
  country?: string;
  areaCode?: number;
  contains?: string;
  limit?: number;
}

/** One incoming-phone-number resource as the SDK returns it. */
type OwnedInstance = Awaited<
  ReturnType<Twilio['incomingPhoneNumbers']['list']>
>[number];

/** The slice of the SDK's `Page` the owned-numbers walk relies on. */
interface OwnedPage {
  instances: OwnedInstance[];
  /** `undefined` once there is no next page — that is how the SDK says "done". */
  nextPage(): Promise<OwnedPage> | undefined;
}

/**
 * Twilio caps a list page at 1000; 100 keeps each response small and the
 * walk below follows `nextPage` regardless, so the count is not a limit.
 */
export const OWNED_NUMBERS_PAGE_SIZE = 100;

const toOwnedNumber = (n: OwnedInstance): OwnedNumber => ({
  sid: n.sid,
  phoneNumber: n.phoneNumber,
  friendlyName: n.friendlyName,
  voiceUrl: n.voiceUrl,
});

@Injectable()
export class NumbersService {
  private readonly logger = new Logger(NumbersService.name);
  /** Shared lazy client + error-translating runner (`TwilioRest` from @bitcrm/shared). */
  private readonly rest: TwilioRest;
  /** Monthly local-number price per country (rarely changes → cached). */
  private priceCache = new Map<
    string,
    { price: string; priceUnit: string } | null
  >();

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
  ) {
    this.rest = new TwilioRest(config);
  }

  private get client(): Twilio {
    return this.rest.client;
  }

  /** New numbers auto-route inbound to our webhook so they work immediately. */
  private inboundUrl(): string {
    return `${this.config.publicBaseUrl}/api/telephony/voice/inbound`;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.rest.run(fn);
  }

  /**
   * Every incoming phone number the account owns, however many. Twilio pages
   * the list; the old `list({ limit: 100 })` silently stopped after the first
   * hundred, which for a workspace with ~270 numbers meant caller-id
   * selection refused market numbers, the technician line could not be
   * designated and the lines-health panel reported numbers as not owned —
   * for two-thirds of the account.
   */
  private async fetchOwned(): Promise<OwnedInstance[]> {
    return this.run(async () => {
      const all: OwnedInstance[] = [];
      let page: OwnedPage | undefined =
        await this.client.incomingPhoneNumbers.page({
          pageSize: OWNED_NUMBERS_PAGE_SIZE,
        });
      while (page) {
        all.push(...page.instances);
        page = await page.nextPage();
      }
      return all;
    });
  }

  async listOwned(): Promise<OwnedNumber[]> {
    const nums = await this.fetchOwned();
    return nums.map(toOwnedNumber);
  }

  /** `listOwned` with the fields the messaging service selects a sender by. */
  async listOwnedDetailed(): Promise<OwnedNumberDetails[]> {
    const nums = await this.fetchOwned();
    return nums.map((n) => ({
      ...toOwnedNumber(n),
      smsUrl: n.smsUrl,
      capabilities: {
        sms: n.capabilities?.sms === true,
        mms: n.capabilities?.mms === true,
        voice: n.capabilities?.voice === true,
      },
    }));
  }

  /**
   * Which Messaging Service each owned number is pooled in: E.164 → `MG…`.
   *
   * A number outside a Messaging Service cannot send to US destinations
   * (A2P 10DLC), so this is what tells the messaging side which numbers are
   * SMS-ready. Scoped to `TWILIO_MESSAGING_SERVICE_SID` when configured,
   * otherwise every service on the account (first one listed wins).
   *
   * Best-effort: the Messaging API being unreachable must not hide the
   * numbers themselves, so any failure yields an empty map — the caller sees
   * "membership unknown", not an error.
   */
  async messagingServiceMembership(): Promise<Map<string, string>> {
    const membership = new Map<string, string>();
    try {
      const messaging = this.client.messaging.v1;
      const serviceSids = this.config.messagingServiceSid
        ? [this.config.messagingServiceSid]
        : (await messaging.services.list()).map((s) => s.sid);
      for (const serviceSid of serviceSids) {
        const members = await messaging.services(serviceSid).phoneNumbers.list();
        for (const m of members) {
          if (!membership.has(m.phoneNumber)) {
            membership.set(m.phoneNumber, serviceSid);
          }
        }
      }
    } catch (e) {
      this.logger.warn(
        `Could not read Messaging Service membership: ${(e as Error).message ?? e}`,
      );
    }
    return membership;
  }

  /** Monthly price for a local number in a country (Pricing API, cached). */
  private async localPrice(
    country: string,
  ): Promise<{ price: string; priceUnit: string } | null> {
    if (this.priceCache.has(country)) return this.priceCache.get(country)!;
    let result: { price: string; priceUnit: string } | null = null;
    try {
      const p = await this.client.pricing.v1.phoneNumbers
        .countries(country)
        .fetch();
      const local =
        p.phoneNumberPrices?.find((x) => x.numberType === 'local') ??
        p.phoneNumberPrices?.[0];
      if (local?.currentPrice != null) {
        result = {
          price: String(local.currentPrice),
          priceUnit: p.priceUnit,
        };
      }
    } catch {
      result = null; // pricing is best-effort; never block a search
    }
    this.priceCache.set(country, result);
    return result;
  }

  async searchAvailable(params: SearchParams): Promise<AvailableNumber[]> {
    const country = params.country || 'US';
    const opts: Record<string, unknown> = { limit: params.limit ?? 20 };
    if (params.areaCode) opts.areaCode = params.areaCode;
    if (params.contains) opts.contains = params.contains;

    const [list, pricing] = await Promise.all([
      this.run(() =>
        this.client.availablePhoneNumbers(country).local.list(opts),
      ),
      this.localPrice(country),
    ]);
    return list.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality,
      region: n.region,
      price: pricing?.price,
      priceUnit: pricing?.priceUnit,
    }));
  }

  async buy(phoneNumber: string): Promise<OwnedNumber> {
    const n = await this.run(() =>
      this.client.incomingPhoneNumbers.create({
        phoneNumber,
        voiceUrl: this.inboundUrl(),
        voiceMethod: 'POST',
      }),
    );
    return {
      sid: n.sid,
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      voiceUrl: n.voiceUrl,
    };
  }

  /**
   * Give a number back to Twilio.
   *
   * Refuses when something still points at it. Releasing deletes at Twilio and
   * touches neither `CallFlow.numbers` nor `ServiceArea.callerId` — so without
   * this, releasing a market number leaves that market dialling clients from a
   * number the workspace no longer owns, and every callback to it landing
   * nowhere. Six weeks later nobody remembers why.
   *
   * `force` exists because sometimes the number really is going away and the
   * references are what need fixing — but it has to be said out loud.
   */
  async release(
    sid: string,
    options: { force?: boolean; referencedBy?: () => Promise<string[]> } = {},
  ): Promise<void> {
    if (!options.force && options.referencedBy) {
      const refs = await options.referencedBy().catch(() => [] as string[]);
      if (refs.length > 0) {
        throw new ConflictException(
          `That number is still in use by ${refs.join(', ')}. ` +
            'Point those elsewhere first, or release it with force.',
        );
      }
    }
    await this.run(() => this.client.incomingPhoneNumbers(sid).remove());
  }
}
