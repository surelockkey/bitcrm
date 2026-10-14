import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { type Twilio } from 'twilio';
import { RedisService, TwilioRest } from '@bitcrm/shared';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { RedisSwrCache } from '../common/redis-swr-cache';

export interface OwnedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl?: string | null;
  /**
   * When the number was bought (ISO), null when Twilio doesn't say — the
   * "Created" column of the numbers list, as Workiz's has.
   */
  dateCreated?: string | null;
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

/**
 * Twilio number data, cached in Redis so every task shares one walk.
 *
 * Fresh for five minutes; up to an hour old it is served at once while one
 * background reload replaces it; older than that the request waits for the
 * reload. A failing reload serves whatever is held. Every path in this
 * service that buys or releases a number drops both keys, so the workspace's
 * own changes show on the next read. A change made in the Twilio console is
 * picked up within five minutes (plus one request).
 */
export const NUMBERS_CACHE = {
  ownedKey: 'telephony:cache:numbers:owned:v1',
  membershipKey: 'telephony:cache:numbers:ms-membership:v1',
  freshMs: 5 * 60_000,
  staleMs: 60 * 60_000,
} as const;

/** Everything any reader of the owned list needs — what the cache holds. */
const toOwnedDetails = (n: OwnedInstance): OwnedNumberDetails => ({
  sid: n.sid,
  phoneNumber: n.phoneNumber,
  friendlyName: n.friendlyName,
  voiceUrl: n.voiceUrl,
  dateCreated: n.dateCreated instanceof Date ? n.dateCreated.toISOString() : null,
  smsUrl: n.smsUrl,
  capabilities: {
    sms: n.capabilities?.sms === true,
    mms: n.capabilities?.mms === true,
    voice: n.capabilities?.voice === true,
  },
});

const toOwnedNumber = (n: OwnedNumberDetails): OwnedNumber => ({
  sid: n.sid,
  phoneNumber: n.phoneNumber,
  friendlyName: n.friendlyName,
  voiceUrl: n.voiceUrl,
  dateCreated: n.dateCreated ?? null,
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

  private readonly ownedCache: RedisSwrCache<OwnedNumberDetails[]>;
  /** E.164 → MG sid, as entries (a Map does not survive JSON). */
  private readonly membershipCache: RedisSwrCache<Array<[string, string]>>;

  constructor(
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
    // Optional so the older specs construct the service with the config
    // alone; without Redis every read goes to Twilio, as it always did.
    @Optional() redis?: RedisService,
  ) {
    this.rest = new TwilioRest(config);
    const timing = {
      freshMs: NUMBERS_CACHE.freshMs,
      staleMs: NUMBERS_CACHE.staleMs,
    };
    this.ownedCache = new RedisSwrCache(redis, NUMBERS_CACHE.ownedKey, timing);
    this.membershipCache = new RedisSwrCache(
      redis,
      NUMBERS_CACHE.membershipKey,
      timing,
    );
  }

  /** Drop both number caches, for every task. Never throws. */
  async invalidateCache(): Promise<void> {
    await Promise.all([
      this.ownedCache.invalidate(),
      this.membershipCache.invalidate(),
    ]);
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
  private async fetchOwned(): Promise<OwnedNumberDetails[]> {
    return this.ownedCache.get(() =>
      this.run(async () => {
        const all: OwnedNumberDetails[] = [];
        let page: OwnedPage | undefined =
          await this.client.incomingPhoneNumbers.page({
            pageSize: OWNED_NUMBERS_PAGE_SIZE,
          });
        while (page) {
          all.push(...page.instances.map(toOwnedDetails));
          page = await page.nextPage();
        }
        return all;
      }),
    );
  }

  async listOwned(): Promise<OwnedNumber[]> {
    const nums = await this.fetchOwned();
    return nums.map(toOwnedNumber);
  }

  /** `listOwned` with the fields the messaging service selects a sender by. */
  async listOwnedDetailed(): Promise<OwnedNumberDetails[]> {
    const nums = await this.fetchOwned();
    return nums.map((n) => ({ ...n, capabilities: { ...n.capabilities } }));
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
   * numbers themselves, so any failure yields the cached map if there is one,
   * else an empty map — the caller sees "membership unknown", not an error.
   * The empty answer is never cached.
   */
  async messagingServiceMembership(): Promise<Map<string, string>> {
    try {
      return new Map(
        await this.membershipCache.get(() => this.fetchMembership()),
      );
    } catch (e) {
      this.logger.warn(
        `Could not read Messaging Service membership: ${(e as Error).message ?? e}`,
      );
      return new Map();
    }
  }

  /** The uncached walk; throws on any failure so nothing partial is cached. */
  private async fetchMembership(): Promise<Array<[string, string]>> {
    const messaging = this.client.messaging.v1;
    const serviceSids = this.config.messagingServiceSid
      ? [this.config.messagingServiceSid]
      : (await messaging.services.list()).map((s) => s.sid);
    // In parallel, folded in listing order — first service listed still wins.
    const perService = await Promise.all(
      serviceSids.map((sid) => messaging.services(sid).phoneNumbers.list()),
    );
    const membership = new Map<string, string>();
    perService.forEach((members, i) => {
      for (const m of members) {
        if (!membership.has(m.phoneNumber)) {
          membership.set(m.phoneNumber, serviceSids[i]);
        }
      }
    });
    return [...membership];
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
    await this.invalidateCache();
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
    try {
      await this.run(() => this.client.incomingPhoneNumbers(sid).remove());
    } finally {
      // Also on failure: Twilio may have released it before the error.
      await this.invalidateCache();
    }
  }
}
