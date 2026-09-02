import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { ExtsService } from './exts.service';
import { DealReadService } from '../common/deal-read.service';
import { ContactLookupService } from '../common/contact-lookup.service';
import { CallerIdResolver } from '../voice/caller-id.resolver';
import { BridgeService } from '../common/bridge.service';
import { UserPhoneLookupService } from '../common/user-phone-lookup.service';

/** Attempts a single caller's number may burn in an hour before it is parked. */
const FAILS_PER_CALLER = 10;
/** A tighter shared bucket for withheld and unrecognised caller ids. */
const FAILS_ANON = 5;
/** A burst across every caller — this is what a war-dialler looks like. */
const FAILS_GLOBAL = 30;
const HOUR_SECONDS = 3600;
const GLOBAL_WINDOW_SECONDS = 300;

/** What a resolved code names. */
export interface DialInMatch {
  dealId: string;
  dealNumber?: string;
  /**
   * Who is calling, when their own number says so and they are on this job.
   * Absent for a borrowed phone or a withheld caller id — the call still
   * connects, it is simply recorded without a name on it.
   */
  technicianId?: string;
  clientName?: string;
  /** The client's real E.164. Never spoken, never sent to a browser. */
  to: string;
  /** The market number the client will see. */
  from: string;
  callerIdSource?: string;
}

/**
 * Resolving the technician dial-in.
 *
 * THE CODE IS THE WHOLE CREDENTIAL. Dial the line, key the code, and the
 * client is dialled — nothing else to remember at a customer's door.
 *
 * What that buys and what it costs, stated plainly because the trade is real:
 * a guessed code opens a CALL to that job's client. It never reveals a phone
 * number — the number is resolved here and handed to Twilio, and is neither
 * spoken nor sent anywhere — so the exposure is a nuisance call, not a leak.
 * The defence is the rate limiting below, which is now the only defence, and
 * the fact that a code dies with its job.
 *
 * The caller's own number is used to NAME them, never to gate them: recognising
 * it puts a name on the call log, and not recognising it is the ordinary case
 * this line exists for — a borrowed phone, a company mobile that never got the
 * app. Caller id is trivially spoofed and so is worth nothing as a gate.
 *
 * The job is re-read LIVE on every call, so a code printed last week cannot
 * outlive the job it names.
 */
@Injectable()
export class DialInService {
  private readonly logger = new Logger(DialInService.name);

  constructor(
    private readonly exts: ExtsService,
    private readonly deals: DealReadService,
    private readonly contacts: ContactLookupService,
    private readonly callerIds: CallerIdResolver,
    private readonly bridge: BridgeService,
    private readonly redis: RedisService,
    private readonly userPhones: UserPhoneLookupService,
  ) {}

  /**
   * Resolve a code, or refuse.
   *
   * Refuses identically for every reason — unknown code, released code, closed
   * job, deal-service unreachable. The CALLER cannot tell them apart, which is
   * what stops the line becoming an oracle that maps live job codes.
   */
  async resolve(
    code: string,
    callerNumber: string,
  ): Promise<DialInMatch | null> {
    if (await this.rateLimited(callerNumber)) {
      this.logger.warn(`Dial-in rate limited for ${callerNumber || 'anonymous'}`);
      return null;
    }

    const outcome = await this.attempt(code, callerNumber);
    if (!outcome) {
      await this.recordFailure(callerNumber);
      return null;
    }
    return outcome;
  }

  private async attempt(
    code: string,
    callerNumber: string,
  ): Promise<DialInMatch | null> {
    const ext = await this.exts.resolve(code).catch(() => null);
    if (!ext) return null;

    // Live, not from when the code was minted: the roster and the job's status
    // are authorisation inputs, and an outage is exactly when you cannot tell a
    // current technician from a removed one — so a failure here REFUSES.
    const deal = await this.deals.find(ext.dealId);
    if (!deal) return null;
    if (deal.closedAt) return null;

    const technicianId = await this.identify(
      callerNumber,
      deal.assignedTechIds ?? [],
    );

    const client = await this.contacts.phonesOf(deal.contactId);
    const to = client?.phones?.[0];
    if (!to) return null;

    const { callerId, source } = await this.callerIds.forServerLeg(deal);

    return {
      dealId: deal.id,
      dealNumber: deal.dealNumber,
      technicianId,
      clientName: client?.name,
      to,
      from: callerId ?? '',
      callerIdSource: source,
    };
  }

  /**
   * Who is calling, if their own number says so and they are on this job.
   *
   * Best-effort by design: this decides whose name goes on the call, not
   * whether the call happens, so a lookup failure costs a name and nothing
   * more. A recognised caller who is NOT on the roster is left unnamed rather
   * than credited, since they are not the technician for this job.
   */
  private async identify(
    callerNumber: string,
    roster: string[],
  ): Promise<string | undefined> {
    if (!callerNumber) return undefined;
    try {
      const found = await this.userPhones.resolve([callerNumber]);
      const user = found[callerNumber];
      if (!user) return undefined;
      return roster.includes(user.id) ? user.id : undefined;
    } catch (error) {
      this.logger.warn(
        `Could not identify caller ${callerNumber}: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }

  /* -------------------------------------------------------- rate limits */

  private failKey(caller: string): string {
    // Withheld and unrecognised callers share one tighter bucket: without it,
    // hiding the caller id would be a way to buy unlimited attempts.
    return caller
      ? `telephony:ext:fail:${caller}`
      : 'telephony:ext:fail:anon';
  }

  private async rateLimited(caller: string): Promise<boolean> {
    try {
      const [perCaller, global] = await Promise.all([
        this.redis.client.get(this.failKey(caller)),
        this.redis.client.get('telephony:ext:fail:global'),
      ]);
      const cap = caller ? FAILS_PER_CALLER : FAILS_ANON;
      if (Number(perCaller ?? 0) >= cap) return true;
      if (Number(global ?? 0) >= FAILS_GLOBAL) return true;
      return false;
    } catch {
      // Redis being down must not take the technician line down with it.
      return false;
    }
  }

  private async recordFailure(caller: string): Promise<void> {
    try {
      const key = this.failKey(caller);
      const count = await this.redis.client.incr(key);
      if (count === 1) await this.redis.client.expire(key, HOUR_SECONDS);

      const global = await this.redis.client.incr('telephony:ext:fail:global');
      if (global === 1) {
        await this.redis.client.expire(
          'telephony:ext:fail:global',
          GLOBAL_WINDOW_SECONDS,
        );
      }
      if (global === FAILS_GLOBAL) {
        this.logger.error(
          `Dial-in failures crossed ${FAILS_GLOBAL} in ${GLOBAL_WINDOW_SECONDS}s — possible enumeration`,
        );
      }
    } catch {
      // Best-effort: never fail a call because a counter did not increment.
    }
  }

  /** Hand a resolved match to the same conference machinery the bridge uses. */
  async openBridge(match: DialInMatch): Promise<string> {
    return this.bridge.stash({
      technicianId: match.technicianId ?? '',
      to: match.to,
      from: match.from,
      callerIdSource: match.callerIdSource,
      dealId: match.dealId,
      contactId: '',
      clientName: match.clientName,
      dealNumber: match.dealNumber,
      actorId: match.technicianId ?? '',
    });
  }
}
