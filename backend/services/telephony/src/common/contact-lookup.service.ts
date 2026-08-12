import { Injectable, Logger } from '@nestjs/common';

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
const CACHE_TTL_MS = 5 * 60_000;
/** The CRM endpoint caps the batch; stay under it. */
const MAX_BATCH = 100;

/** A caller matched to a CRM contact. */
export interface CallContact {
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
        this.cache.set(phone, { contact, expiresAt: now + CACHE_TTL_MS });
        if (contact) out[phone] = contact;
      }
    }
    return out;
  }

  /** Drop a number from the cache — call after a contact is created for it. */
  invalidate(phone: string): void {
    this.cache.delete(phone);
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
          { id: string; firstName?: string; lastName?: string; companyId?: string }
        >;
      };
      const out: Record<string, CallContact> = {};
      for (const [phone, c] of Object.entries(body.data ?? {})) {
        const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
        out[phone] = { id: c.id, name: name || 'Unnamed contact', companyId: c.companyId };
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
