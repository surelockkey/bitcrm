import { Injectable, Logger } from '@nestjs/common';

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 5 * 60_000;
/**
 * Misses expire far sooner than hits. An unknown number becomes a client the
 * moment someone clicks "Add client" on that very call — caching the miss for
 * minutes makes the feature look broken, since the UI refetches immediately
 * and gets the stale nothing back. Still long enough to absorb the burst of
 * lookups from one page render.
 */
const MISS_TTL_MS = 20_000;
/** The CRM endpoint caps the batch; stay under it. */
const MAX_BATCH = 100;

/** A caller matched in the CRM — a person, or a company's main line. */
export interface CallContact {
  kind: 'contact' | 'company';
  id: string;
  name: string;
  companyId?: string;
}

interface CacheEntry {
  /** null caches a miss — unknown numbers are the common case and re-asking
   *  the CRM for every one of them on every page render is pure waste. */
  contact: CallContact | null;
  expiresAt: number;
}

/**
 * Resolves phone numbers to CRM contacts through the crm-service internal API
 * (`POST /api/crm/contacts/internal/by-phones`, `x-internal-secret`), batched
 * per request and cached briefly. Best-effort like {@link UserNamesService}:
 * an unreachable CRM shows numbers without names, it never fails a call
 * endpoint. Look-up only — a call from a stranger must not create a contact.
 */
@Injectable()
export class ContactLookupService {
  private readonly logger = new Logger(ContactLookupService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly nameCache = new Map<
    string,
    { name: string | null; expiresAt: number }
  >();

  /**
   * The numbers on one client record, read live at dial time.
   *
   * The whole point of the masked bridge: the browser sends a `contactId` and
   * a `phoneIndex`, never an E.164, and this is where the digits enter the
   * system — server-side, moments before Twilio dials them.
   *
   * Deliberately NOT cached. Everything else here is a display lookup where a
   * stale answer costs a wrong label; this one decides who gets rung, and a
   * number corrected two minutes ago must be the number we call. It is also
   * one request per placed call, which is nothing.
   */
  async phonesOf(
    contactId: string,
  ): Promise<{ phones: string[]; name?: string } | null> {
    if (!contactId) return null;
    try {
      const res = await fetch(
        `${CRM_SERVICE_URL}/api/crm/contacts/internal/${encodeURIComponent(contactId)}`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        this.logger.warn(`contact ${contactId} lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: { phones?: string[]; firstName?: string; lastName?: string };
      };
      if (!body.data) return null;
      const name = [body.data.firstName, body.data.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      return { phones: body.data.phones ?? [], name: name || undefined };
    } catch (error) {
      this.logger.warn(
        `contact ${contactId} lookup failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  async resolve(phones: string[]): Promise<Record<string, CallContact>> {
    // `client:<id>` legs and blanks aren't numbers — never ask about them.
    const unique = [
      ...new Set(phones.filter((p) => p && p.startsWith('+'))),
    ];
    const out: Record<string, CallContact> = {};
    const misses: string[] = [];

    const now = Date.now();
    for (const phone of unique) {
      const hit = this.cache.get(phone);
      if (hit && hit.expiresAt > now) {
        if (hit.contact) out[phone] = hit.contact;
      } else {
        misses.push(phone);
      }
    }
    if (misses.length === 0) return out;

    for (let i = 0; i < misses.length; i += MAX_BATCH) {
      const batch = misses.slice(i, i + MAX_BATCH);
      const found = await this.fetchBatch(batch);
      if (!found) continue; // CRM unreachable — leave these uncached, retry next time
      for (const phone of batch) {
        const contact = found[phone] ?? null;
        this.cache.set(phone, {
          contact,
          expiresAt: now + (contact ? CACHE_TTL_MS : MISS_TTL_MS),
        });
        if (contact) out[phone] = contact;
      }
    }
    return out;
  }

  /**
   * Names for parties a call is already associated with. Separate cache from
   * the by-phone one: this is keyed by identity, which is exactly the point —
   * the number may since have moved to somebody else.
   */
  async resolveRefs(
    refs: Array<{ kind: 'contact' | 'company'; id: string }>,
  ): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const misses: Array<{ kind: 'contact' | 'company'; id: string }> = [];

    const now = Date.now();
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`;
      const hit = this.nameCache.get(key);
      if (hit && hit.expiresAt > now) {
        if (hit.name) out[key] = hit.name;
      } else {
        misses.push(ref);
      }
    }
    if (!misses.length) return out;

    try {
      const res = await fetch(
        `${CRM_SERVICE_URL}/api/crm/contacts/internal/by-ids`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({ refs: misses.slice(0, 200) }),
        },
      );
      if (!res.ok) return out;
      const body = (await res.json()) as {
        data?: Record<string, { name?: string }>;
      };
      for (const ref of misses) {
        const key = `${ref.kind}:${ref.id}`;
        const name = body.data?.[key]?.name ?? null;
        this.nameCache.set(key, { name, expiresAt: now + CACHE_TTL_MS });
        if (name) out[key] = name;
      }
    } catch (error) {
      this.logger.warn(
        `party name lookup failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    return out;
  }

  private async fetchBatch(
    phones: string[],
  ): Promise<Record<string, CallContact> | null> {
    try {
      const res = await fetch(
        `${CRM_SERVICE_URL}/api/crm/contacts/internal/by-phones`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({ phones }),
        },
      );
      if (!res.ok) {
        this.logger.warn(`contact lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: Record<
          string,
          {
            kind?: 'contact' | 'company';
            id: string;
            firstName?: string;
            lastName?: string;
            companyId?: string;
          }
        >;
      };
      const out: Record<string, CallContact> = {};
      for (const [phone, c] of Object.entries(body.data ?? {})) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
        out[phone] = {
          kind: c.kind ?? 'contact',
          id: c.id,
          name: name || 'Unnamed contact',
          companyId: c.companyId,
        };
      }
      return out;
    } catch (error) {
      this.logger.warn(
        `contact lookup failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }
}
