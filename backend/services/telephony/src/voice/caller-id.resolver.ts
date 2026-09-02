import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  TELEPHONY_CONFIG,
  type TelephonyConfig,
} from '../telephony/telephony.config';
import { NumbersService } from '../numbers/numbers.service';
import { ServiceAreaNumbersService } from '../common/service-area-numbers.service';
import { type DealForCall } from '../common/deal-read.service';
import { type CallRecord } from '../calls/calls.repository';

/** Which rung of the chain won, stamped onto the call record. */
export type CallerIdSource = NonNullable<CallRecord['callerIdSource']>;

export interface ResolvedCallerId {
  callerId?: string;
  source?: CallerIdSource;
}

/** A plausible E.164 — the same sanity filter `pickCallerId` has always used. */
const looksE164 = (v: string | undefined): v is string =>
  !!v && /^\+\d{6,15}$/.test(v);

/** How long the owned-number set is trusted. Matches VoiceService's cache. */
const OWNED_TTL_MS = 60_000;

/**
 * Which of our numbers a client sees.
 *
 * TWO chains, because two different actors are choosing, and they disagree
 * deliberately:
 *
 *  - **Server-placed legs** (the masked bridge, the technician dial-in): the
 *    job's market number wins outright. That is the requirement — an Atlanta
 *    job's client is called from the Atlanta number, every time.
 *  - **The human dialer**: the agent's explicit pick wins, because the shipped
 *    rationale for the caller-id picker is that clients answer the number they
 *    already recognise, and only the system's own legs are "about a market".
 *
 * Every candidate is checked against the numbers the workspace actually owns.
 * Caller id is NOT validated at dial time — `pickCallerId` is a regex filter
 * and its own comment says it is not a security boundary — so a market pointed
 * at a released number would otherwise surface weeks later as a client whose
 * call simply hangs up.
 *
 * **A call is never refused for want of a caller id.** Every rung can miss and
 * the result is an empty `callerId`, which the caller handles as it always has.
 */
@Injectable()
export class CallerIdResolver {
  private readonly logger = new Logger(CallerIdResolver.name);
  private owned: { numbers: Set<string>; expiresAt: number } | null = null;

  constructor(
    private readonly areaNumbers: ServiceAreaNumbersService,
    private readonly numbers: NumbersService,
    @Inject(TELEPHONY_CONFIG) private readonly config: TelephonyConfig,
  ) {}

  /** The chain for a leg the SYSTEM places. Market first. */
  async forServerLeg(deal?: DealForCall): Promise<ResolvedCallerId> {
    return this.firstOwned([
      ['area', await this.marketNumber(deal)],
      ['default', this.config.defaultAreaCallerId || this.config.callerId],
      ['owned', await this.firstOwnedNumber()],
    ]);
  }

  /** The chain for a leg a HUMAN dialled. Their pick first. */
  async forDialer(
    requested: string | undefined,
    deal?: DealForCall,
  ): Promise<ResolvedCallerId> {
    return this.firstOwned([
      ['agent', looksE164(requested) ? requested : undefined],
      ['area', await this.marketNumber(deal)],
      ['default', this.config.defaultAreaCallerId || this.config.callerId],
      ['owned', await this.firstOwnedNumber()],
    ]);
  }

  private async marketNumber(deal?: DealForCall): Promise<string | undefined> {
    if (!deal?.serviceAreaId) return undefined;
    try {
      return await this.areaNumbers.callerIdFor(deal.serviceAreaId);
    } catch (error) {
      // The catalog being slow must not decide whether a call happens.
      this.logger.warn(
        `market caller id lookup failed for ${deal.serviceAreaId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return undefined;
    }
  }

  /**
   * The first candidate that is both plausible and ours. The last rung is the
   * account's first owned number, which is trivially owned — checking it again
   * costs nothing and keeps the loop uniform.
   */
  private async firstOwned(
    candidates: Array<[CallerIdSource, string | undefined]>,
  ): Promise<ResolvedCallerId> {
    const owned = await this.ownedNumbers();
    for (const [source, candidate] of candidates) {
      if (!looksE164(candidate)) continue;
      // An empty owned set means Twilio was unreachable, not that we own
      // nothing — refusing every caller id then would take the phones down.
      if (owned.size && !owned.has(candidate)) {
        this.logger.warn(
          `caller id ${candidate} (${source}) is not a workspace number — skipping`,
        );
        continue;
      }
      return { callerId: candidate, source };
    }
    return {};
  }

  private async firstOwnedNumber(): Promise<string | undefined> {
    const [first] = await this.ownedNumbers();
    return first;
  }

  private async ownedNumbers(): Promise<Set<string>> {
    if (this.owned && this.owned.expiresAt > Date.now()) return this.owned.numbers;
    try {
      const list = await this.numbers.listOwned();
      const numbers = new Set(list.map((n) => n.phoneNumber));
      this.owned = { numbers, expiresAt: Date.now() + OWNED_TTL_MS };
      return numbers;
    } catch {
      return this.owned?.numbers ?? new Set();
    }
  }
}
