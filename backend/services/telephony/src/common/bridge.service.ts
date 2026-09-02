import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from '@bitcrm/shared';
import { type JwtUser } from '@bitcrm/types';
import { DealReadService, type DealForCall } from './deal-read.service';
import { ContactLookupService } from './contact-lookup.service';
import { CallerIdResolver } from '../voice/caller-id.resolver';
import { CallsService } from '../calls/calls.service';

/** Long enough for a technician to answer and press a key, and no longer. */
const CONTEXT_TTL_SECONDS = 300;
/**
 * Covers the window between minting a bridge and the leg reaching a terminal
 * status, at which point it is released explicitly (see
 * `ConferenceService.releaseFinishedBridge`).
 *
 * The TTL is only the backstop for a release that never arrives, so it is set
 * to the shortest span that still covers the gap this key alone can guard:
 * from `calls.create` until a call record exists for `activeCallFor` to see,
 * which is a couple of seconds. Ninety seconds of backstop meant one missed
 * webhook took somebody's phone away for a minute and a half — for a guard
 * whose entire job is to absorb a double-tap.
 */
const USER_CLAIM_TTL_SECONDS = 20;

export const bridgeKey = (bridgeId: string) => `telephony:bridge:${bridgeId}`;
export const bridgeClaimKey = (bridgeId: string) =>
  `telephony:bridge:claim:${bridgeId}`;
export const bridgeUserKey = (userId: string) =>
  `telephony:bridge:tech:${userId}`;

/** What the browser sends. Note there is no phone number in it. */
export interface BridgeRequest {
  dealId: string;
  contactId: string;
  /** Which of the client's numbers to ring. Defaults to the first. */
  phoneIndex?: number;
}

/** Everything the answer webhook needs, stashed in Redis until it fires. */
export interface BridgeContext {
  technicianId: string;
  /** The client's real E.164 — the only place it lives during a bridge. */
  to: string;
  /** The market number the client will see. */
  from: string;
  callerIdSource?: string;
  dealId: string;
  contactId: string;
  clientName?: string;
  dealNumber?: string;
  /** Who asked for the call, which may not be the technician being rung. */
  actorId: string;
}

/**
 * Authorisation and preparation for a masked call, shared by both ways in:
 * the in-app bridge and the technician dial-in.
 *
 * The rule that holds the feature together is {@link mayReachDeal}. Two
 * transports, one rule, one place to read when somebody asks why a call
 * connected.
 */
@Injectable()
export class BridgeService {
  private readonly logger = new Logger(BridgeService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly deals: DealReadService,
    private readonly contacts: ContactLookupService,
    private readonly callerIds: CallerIdResolver,
    private readonly calls: CallsService,
  ) {}

  /**
   * May this user place a call about this job?
   *
   * A technician must be on the roster — that is the whole point, and it is
   * re-read live at dial time rather than trusted from when the code was
   * minted. Everyone else (dispatch, managers) may call any client about any
   * job; masking is about not handing out numbers, not about restricting who
   * may speak to whom.
   */
  mayReachDeal(user: JwtUser, deal: DealForCall): boolean {
    if (user.roleId !== 'role-technician') return true;
    return (deal.assignedTechIds ?? []).includes(user.id);
  }

  /**
   * Authorise, resolve the client's number server-side, and stash everything
   * the answer webhook will need.
   *
   * Returns no phone number. The browser gets a bridge id and a client NAME;
   * the digits stay between this service, Redis and Twilio.
   */
  async prepare(
    user: JwtUser,
    req: BridgeRequest,
  ): Promise<{
    bridgeId: string;
    clientName?: string;
    dealNumber?: string;
    callerId?: string;
  }> {
    const deal = await this.deals.find(req.dealId);
    if (!deal) throw new NotFoundException('Job not found');

    if (!this.mayReachDeal(user, deal)) {
      // Deliberately not "you are not on this job": the refusal is the same
      // whatever the reason, so it cannot be used to map job rosters.
      this.logger.warn(
        `Bridge refused: ${user.id} may not reach deal ${req.dealId}`,
      );
      throw new ForbiddenException('You cannot place a call about this job');
    }

    if (req.contactId !== deal.contactId) {
      throw new BadRequestException('That client is not on this job');
    }

    const client = await this.contacts.phonesOf(req.contactId);
    const index = req.phoneIndex ?? 0;
    const to = client?.phones?.[index];
    if (!to) {
      throw new BadRequestException(
        client?.phones?.length
          ? 'That client has no number at that position'
          : 'That client has no phone number on file',
      );
    }

    // One in-flight bridge per user. A double-tap on a mobile is one gesture,
    // and each tap would otherwise place a real PSTN call. This NX key is the
    // only thing doing that work — `activeCallFor` cannot, because on the cell
    // path no participant exists yet when the second tap lands.
    const bridgeId = randomUUID();
    const claimed = await this.redis.client.set(
      bridgeUserKey(user.id),
      bridgeId,
      'EX',
      USER_CLAIM_TTL_SECONDS,
      'NX',
    );
    if (claimed !== 'OK') {
      throw new ConflictException('You already have a call starting');
    }

    try {
      const active = await this.calls.activeCallFor(user.id);
      if (active) {
        throw new ConflictException('You are already on a call');
      }

      const { callerId, source } = await this.callerIds.forServerLeg(deal);

      const context: BridgeContext = {
        technicianId: user.id,
        to,
        from: callerId ?? '',
        callerIdSource: source,
        dealId: deal.id,
        contactId: req.contactId,
        clientName: client?.name,
        dealNumber: deal.dealNumber,
        actorId: user.id,
      };
      await this.redis.client.hset(
        bridgeKey(bridgeId),
        // Redis hashes hold strings; drop the absent fields rather than
        // writing "undefined" and reading it back as a real value later.
        Object.fromEntries(
          Object.entries(context).filter(([, v]) => v !== undefined && v !== ''),
        ) as Record<string, string>,
      );
      await this.redis.client.expire(bridgeKey(bridgeId), CONTEXT_TTL_SECONDS);

      return {
        bridgeId,
        clientName: client?.name,
        dealNumber: deal.dealNumber,
        callerId,
      };
    } catch (error) {
      // Never leave the user locked out because preparation failed.
      await this.release(user.id, bridgeId);
      throw error;
    }
  }

  /**
   * Stash a context that was authorised somewhere other than `prepare` — the
   * technician dial-in, where the caller proved who they are with a PIN rather
   * than a JWT. Same Redis shape, same answer webhook, same conference.
   */
  async stash(context: BridgeContext): Promise<string> {
    const bridgeId = randomUUID();
    await this.redis.client.hset(
      bridgeKey(bridgeId),
      Object.fromEntries(
        Object.entries(context).filter(([, v]) => v !== undefined && v !== ''),
      ) as Record<string, string>,
    );
    await this.redis.client.expire(bridgeKey(bridgeId), CONTEXT_TTL_SECONDS);
    return bridgeId;
  }

  /** The stashed context, or null once it has expired or been cleared. */
  async context(bridgeId: string): Promise<BridgeContext | null> {
    if (!bridgeId) return null;
    const raw = await this.redis.client.hgetall(bridgeKey(bridgeId));
    if (!raw || !raw.to || !raw.technicianId) return null;
    return raw as unknown as BridgeContext;
  }

  /**
   * Drop the per-user claim, and optionally the context with it.
   *
   * Must run on EVERY terminal leg status, not only the unanswered case — a
   * successful, answered call takes neither the cancel path nor the no-answer
   * path, and would otherwise sit on the claim until its TTL expired.
   */
  async release(userId: string, bridgeId?: string): Promise<void> {
    const keys = [bridgeUserKey(userId)];
    if (bridgeId) keys.push(bridgeKey(bridgeId), bridgeClaimKey(bridgeId));
    await this.redis.client.del(...keys).catch(() => undefined);
  }

  /** The leg sid that claimed this bridge's answer webhook, if any. */
  async answerClaim(bridgeId: string): Promise<string | null> {
    return this.redis.client.get(bridgeClaimKey(bridgeId));
  }

  /**
   * Single-use claim on the answer webhook, so a Twilio retry cannot build two
   * conferences for one bridge. Mirrors `telephony:conf:<name>:customer-dial`.
   */
  async claimAnswer(bridgeId: string, callSid: string): Promise<boolean> {
    const ok = await this.redis.client.set(
      bridgeClaimKey(bridgeId),
      callSid,
      'EX',
      CONTEXT_TTL_SECONDS,
      'NX',
    );
    return ok === 'OK';
  }
}
