import { Inject, Injectable } from '@nestjs/common';
import { type Twilio } from 'twilio';
import { TwilioRest } from '../common/twilio-client';
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

@Injectable()
export class NumbersService {
  /** Shared lazy client + error-translating runner (src/common/twilio-client). */
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

  async listOwned(): Promise<OwnedNumber[]> {
    const nums = await this.run(() =>
      this.client.incomingPhoneNumbers.list({ limit: 100 }),
    );
    return nums.map((n) => ({
      sid: n.sid,
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      voiceUrl: n.voiceUrl,
    }));
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

  async release(sid: string): Promise<void> {
    await this.run(() => this.client.incomingPhoneNumbers(sid).remove());
  }
}
