import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { CALL_FLOW_LIMITS } from '@bitcrm/types';
import { ExtsRepository, type CallExt } from './exts.repository';

/** How many times to redraw before admitting the space is too crowded.
 *  Ten rather than five because a four-digit space is denser than a six-digit
 *  one: at ~2,600 codes in circulation a single draw collides about a third of
 *  the time, and ten draws put a spurious "try again" below one in ten
 *  thousand. A redraw is one conditional write, so the retries are cheap. */
const MINT_ATTEMPTS = 10;
/**
 * At most this many client numbers on one job get a code. Workiz jobs carry
 * two or three; the cap only stops a pathological record from minting a code
 * per number into a four-digit space.
 */
const MAX_CODES_PER_JOB = 10;

/**
 * Job codes for the technician dial-in.
 *
 * SHAPE — four digits, drawn with `crypto.randomInt` so there is never a
 * leading zero and every code is exactly four keypresses. Short because a
 * technician keys it one-handed at a customer's door. It can afford to be
 * short because THE CODE IS NOT THE CREDENTIAL — the technician's PIN is, and
 * it is checked against that job's roster; the code is only a routing key.
 * See CALL_FLOW_LIMITS.extDigits for why not three.
 *
 * Random, never sequential: a sequential code leaks job volume and makes
 * "yesterday's code plus one" a live guess.
 *
 * SCOPE — one code per (JOB, CLIENT NUMBER), Workiz style: every number on the
 * job gets its own masked number, so the technician at the door can pick the
 * mobile over the landline exactly as the in-app buttons let them. Never per
 * client (one leak would expose every job that client will ever have) and not
 * per (job, technician) — a job's roster is a peer list, and the identity that
 * would buy is bought better by the PIN.
 *
 * The position is the bridge's `phoneIndex` (see `clientLineAt`). The first
 * number's code lives where the one-code-per-job design kept it, so codes
 * minted before this read as the first number's and keep working.
 */
@Injectable()
export class ExtsService {
  private readonly logger = new Logger(ExtsService.name);

  constructor(private readonly repo: ExtsRepository) {}

  /**
   * The code for a job, minted on first ask.
   *
   * Lazy on purpose: most jobs never need one, and the job screen is the only
   * thing that asks. Idempotent through the reverse row, so re-rendering the
   * screen does not burn codes.
   */
  async forDeal(dealId: string, phoneIndex = 0): Promise<CallExt> {
    const existing = await this.repo.findByDeal(dealId, phoneIndex);
    if (existing && existing.status === 'active') {
      // A code minted at a different length can never be keyed in again: the
      // dial-in gathers exactly `extDigits` digits and stops. Rather than
      // leave the job screen showing a number that silently cannot work, the
      // next look at the job re-mints it.
      if (existing.code.length === CALL_FLOW_LIMITS.extDigits) return existing;
      this.logger.log(
        `Re-minting the code for deal ${dealId}: it was ${existing.code.length} digits, and the dial-in now takes ${CALL_FLOW_LIMITS.extDigits}`,
      );
      await this.repo.release(existing.code);
    }

    for (let attempt = 0; attempt < MINT_ATTEMPTS; attempt += 1) {
      const code = this.draw();
      const minted = await this.repo.claim(code, dealId, phoneIndex);
      if (minted) {
        this.logger.log(`Minted a job code for deal ${dealId} (number ${phoneIndex + 1})`);
        return minted;
      }
    }

    // Loudly, and with a real message: silently returning nothing would leave
    // the job screen showing a dial card that cannot work.
    throw new ServiceUnavailableException(
      'Could not allocate a job code right now — please try again',
    );
  }

  /**
   * The codes for every client number on a job, in position order — what the
   * job screen shows beside each number.
   *
   * Always at least the first number's, which is the code the job always had
   * (a client with no number on file, or one we could not read, still gets
   * it). Capped, so a client record with dozens of numbers cannot mint dozens
   * of codes. Sequential on purpose: each is a conditional write, and a job
   * has two or three numbers.
   */
  async forDealPhones(dealId: string, count: number): Promise<CallExt[]> {
    const wanted = Math.min(Math.max(1, Math.floor(count) || 0), MAX_CODES_PER_JOB);
    const out: CallExt[] = [];
    for (let phoneIndex = 0; phoneIndex < wanted; phoneIndex += 1) {
      out.push(await this.forDeal(dealId, phoneIndex));
    }
    return out;
  }

  /** The job a code points at, or null. Never says WHY it is null. */
  async resolve(code: string): Promise<CallExt | null> {
    if (!/^\d+$/.test(code ?? '')) return null;
    const found = await this.repo.findByCode(code);
    if (!found || found.status !== 'active') return null;
    return found;
  }

  /**
   * Retire a job's code and mint a new one — the containment lever when a code
   * has been shared too widely. Scoped to one job on purpose.
   */
  async rotate(dealId: string, phoneIndex = 0): Promise<CallExt> {
    const existing = await this.repo.findByDeal(dealId, phoneIndex);
    if (existing) await this.repo.release(existing.code);
    return this.forDeal(dealId, phoneIndex);
  }

  /**
   * Retire every one of a job's codes without replacing them — used when a
   * job closes. (The dial-in also refuses a closed job on its own: it re-reads
   * the job on every call.)
   */
  async releaseForDeal(dealId: string): Promise<void> {
    const all = await this.repo.listByDeal(dealId);
    await Promise.all(
      all
        .filter((ext) => ext.status === 'active')
        .map((ext) => this.repo.release(ext.code)),
    );
  }

  /**
   * Never with a leading zero, so the spoken and keyed forms agree and every
   * code is the same length.
   */
  private draw(): string {
    const digits = CALL_FLOW_LIMITS.extDigits;
    const min = 10 ** (digits - 1);
    return String(randomInt(min, 10 ** digits));
  }
}
