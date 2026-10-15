import { Injectable, Logger } from '@nestjs/common';
import { CallsRepository, type CallRecord } from './calls.repository';

const MESSAGING_SERVICE_URL = process.env.MESSAGING_SERVICE_URL || 'http://localhost:4007';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** How many of the client's newest calls are read — enough to step over a few that never reached them. */
const CALLS_READ = 20;
/**
 * How long messaging may take before the SMS side is dropped. This runs while
 * a technician waits for their phone to ring; a slow messaging costs the SMS
 * number, never the call.
 */
const MESSAGING_TIMEOUT_MS = 1_500;
/** Calls the client never took part in: refused by Twilio, or turned away as blocked. */
const NEVER_REACHED: ReadonlySet<string> = new Set(['failed', 'blocked']);

const looksE164 = (v: string | undefined): v is string => !!v && /^\+\d{6,15}$/.test(v);

/** A company number the client talked to, and when (absent: known, but not when). */
interface Seen {
  number: string;
  at?: string;
}

/** Epoch ms of `at`, or null when there is no usable time. */
const timeOf = (s: Seen): number | null => {
  const t = s.at ? Date.parse(s.at) : NaN;
  return Number.isNaN(t) ? null : t;
};

/**
 * The company number on our side of a call: the one we showed on an outbound
 * call, the one they rang on an inbound one. Nothing for a call that never
 * reached the client, or for the hidden leg of a call between two of our own.
 */
function companyNumberOf(call: CallRecord): string | undefined {
  if (call.internalLegOf || (call.status && NEVER_REACHED.has(call.status))) return undefined;
  const number =
    call.direction === 'outbound' ? call.from : call.direction === 'inbound' ? call.to : undefined;
  return looksE164(number) ? number : undefined;
}

/**
 * Which company numbers a client has been talking to, newest first — what the
 * masked call shows the client (2026-10-15: "from the number the client has
 * been talking to"). `CallerIdResolver.forServerLeg` takes the first one the
 * workspace still owns.
 *
 * Two sources, the newer first:
 *  - **Calls** — telephony's own log, the client's calls on the PartyIndex
 *    (`PARTY#contact#<id>`, newest first). It holds calls whose parties
 *    `CallFinalizer` has frozen, a few seconds after each ends.
 *  - **Texts** — messaging owns the SMS thread and the company number of each
 *    message: `GET /conversations/internal/by-party/contact/:id/business-number`
 *    (`x-internal-secret`).
 *
 * Best effort, like every caller-id rung: either source failing leaves the
 * other, and nothing here ever fails a call.
 */
@Injectable()
export class ClientNumberHistory {
  private readonly logger = new Logger(ClientNumberHistory.name);

  constructor(private readonly calls: CallsRepository) {}

  async numbersFor(contactId: string): Promise<string[]> {
    if (!contactId) return [];
    const [calls, text] = await Promise.all([this.fromCalls(contactId), this.fromTexts(contactId)]);
    const seen = text ? [...calls, text] : calls;
    // Newest first; one with no time after every dated one.
    seen.sort((a, b) => {
      const ta = timeOf(a);
      const tb = timeOf(b);
      if (ta === null || tb === null) return ta === null ? (tb === null ? 0 : 1) : -1;
      return tb - ta;
    });
    return [...new Set(seen.map((s) => s.number))];
  }

  private async fromCalls(contactId: string): Promise<Seen[]> {
    try {
      const page = await this.calls.listByParty('contact', contactId, CALLS_READ);
      return page.items.flatMap((call) => {
        const number = companyNumberOf(call);
        return number ? [{ number, at: call.startedAt }] : [];
      });
    } catch (error) {
      this.logger.warn(
        `calls of contact ${contactId} unreadable for caller id: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  private async fromTexts(contactId: string): Promise<Seen | null> {
    try {
      const res = await fetch(
        `${MESSAGING_SERVICE_URL}/api/messaging/conversations/internal/by-party/contact/${encodeURIComponent(contactId)}/business-number`,
        {
          headers: { 'x-internal-secret': INTERNAL_SECRET },
          signal: AbortSignal.timeout(MESSAGING_TIMEOUT_MS),
        },
      );
      if (!res.ok) throw new Error(`messaging returned ${res.status}`);
      const body = (await res.json()) as { data?: { businessNumber?: string; at?: string } | null };
      const number = body.data?.businessNumber;
      return looksE164(number) ? { number, at: body.data?.at } : null;
    } catch (error) {
      this.logger.warn(
        `SMS number of contact ${contactId} unreadable for caller id: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
