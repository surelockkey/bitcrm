import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

interface FetchAnswer {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type CompanyNumbersFetch = (url: string, init: { headers: Record<string, string> }) => Promise<FetchAnswer>;
export const COMPANY_NUMBERS_FETCH = Symbol('COMPANY_NUMBERS_FETCH');

/** A number bought or released shows within this; the list changes rarely. */
const TTL_MS = 5 * 60_000;

/**
 * The company's own phone numbers (every Twilio number the account owns),
 * which a client record must never carry: texting the client would make
 * Twilio pick that same number as the sender and refuse with 21266. Telephony
 * owns the numbers; this reads its internal listing
 * (`GET /api/telephony/numbers/internal/owned`, `x-internal-secret`) and
 * caches it.
 *
 * Fails OPEN, unlike `ClientCustomFieldsCatalog`: telephony being down must
 * not stop the office saving a client, so a failed read answers the last good
 * list, or an empty set ("refuse nothing") before the first success — and
 * logs a warning. A failure is not cached; the next call asks again.
 */
@Injectable()
export class CompanyNumbersCatalog {
  private readonly logger = new Logger(CompanyNumbersCatalog.name);
  private cached?: { numbers: Set<string>; expiresAt: number };

  constructor(@Optional() @Inject(COMPANY_NUMBERS_FETCH) private readonly fetchImpl?: CompanyNumbersFetch) {}

  async numbers(): Promise<Set<string>> {
    if (this.cached && this.cached.expiresAt > Date.now()) return this.cached.numbers;

    const base = process.env.TELEPHONY_SERVICE_URL || 'http://localhost:4006';
    const fetchImpl = this.fetchImpl ?? (globalThis.fetch as unknown as CompanyNumbersFetch);
    try {
      const res = await fetchImpl(`${base}/api/telephony/numbers/internal/owned`, {
        headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' },
      });
      if (!res.ok) throw new Error(`telephony answered ${res.status}`);
      const rows = ((await res.json()) as { data?: unknown })?.data;
      if (!Array.isArray(rows)) throw new Error('telephony sent no list');
      const numbers = new Set(
        (rows as Array<{ phoneNumber?: unknown }>)
          .map((r) => r?.phoneNumber)
          .filter((p): p is string => typeof p === 'string' && p.length > 0),
      );
      this.cached = { numbers, expiresAt: Date.now() + TTL_MS };
      return numbers;
    } catch (error) {
      this.logger.warn(
        `Company phone numbers could not be read (${(error as Error).message}) — not checking client phones against them`,
      );
      return this.cached?.numbers ?? new Set();
    }
  }
}
