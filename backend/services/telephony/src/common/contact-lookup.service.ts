import { Injectable, Logger, Optional } from '@nestjs/common';
import { RedisService } from '@bitcrm/shared';
import { RedisBatchCache } from './redis-batch-cache';

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** A known name: ten minutes (a rename is pushed by contact-events anyway). */
const CACHE_TTL_MS = 10 * 60_000;
/**
 * An unknown number: five minutes. An unknown number becomes a client the
 * moment someone clicks "Add client" on that very call — so contact.created /
 * contact.updated (telephony's deal-events-to-telephony queue, which also
 * carries contact-events) drop the new client's numbers from the cache
 * (`forgetContact`), and the UI's refetch sees the client.
 */
const MISS_TTL_MS = 5 * 60_000;
/** The CRM endpoint caps the batch; stay under it. */
const MAX_BATCH = 100;

/** A caller matched in the CRM — a person, or a company's main line. */
export interface CallContact {
  kind: 'contact' | 'company';
  id: string;
  name: string;
  companyId?: string;
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
  /**
   * By number; `null` caches a miss — unknown numbers are the common case and
   * re-asking the CRM for every one of them on every page render is waste.
   */
  private readonly byPhone: RedisBatchCache<CallContact>;
  /** By identity (`contact:<id>` / `company:<id>`) → current name. */
  private readonly byRef: RedisBatchCache<string>;

  constructor(@Optional() redis?: RedisService) {
    this.byPhone = new RedisBatchCache<CallContact>(redis, 'telephony:names:contact-phone:v1', {
      hitTtlMs: CACHE_TTL_MS,
      missTtlMs: MISS_TTL_MS,
    });
    this.byRef = new RedisBatchCache<string>(redis, 'telephony:names:contact-ref:v1', {
      hitTtlMs: CACHE_TTL_MS,
      missTtlMs: MISS_TTL_MS,
    });
  }

  /**
   * A contact was created, edited or merged: drop its numbers (a cached miss
   * would hide the new client for minutes) and its name from every task's
   * cache. Its numbers are read from the CRM — the event carries none.
   */
  async forgetContact(contactId: string): Promise<void> {
    const keys = [`contact:${contactId}`];
    await this.byRef.invalidate(keys);
    const found = await this.phonesOf(contactId);
    if (found?.phones?.length) await this.byPhone.invalidate(found.phones);
  }

  /** A company was created or edited: drop its name from every task's cache. */
  async forgetCompany(companyId: string): Promise<void> {
    await this.byRef.invalidate([`company:${companyId}`]);
  }

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
  ): Promise<{
    phones: string[];
    name?: string;
    /** What to press on each number once it answers, keyed by the number. */
    extensions?: Record<string, string>;
  } | null> {
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
        data?: {
          phones?: string[];
          firstName?: string;
          lastName?: string;
          phoneExtensions?: Record<string, string>;
        };
      };
      if (!body.data) return null;
      const name = [body.data.firstName, body.data.lastName]
        .filter(Boolean)
        .join(' ')
        .trim();
      const extensions = body.data.phoneExtensions;
      return {
        phones: body.data.phones ?? [],
        name: name || undefined,
        ...(extensions && Object.keys(extensions).length > 0 && { extensions }),
      };
    } catch (error) {
      this.logger.warn(
        `contact ${contactId} lookup failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  async resolve(phones: string[]): Promise<Record<string, CallContact>> {
    // `client:<id>` legs and blanks aren't numbers — never ask about them.
    const unique = [...new Set(phones.filter((p) => p && p.startsWith('+')))];
    if (!unique.length) return {};
    const found = await this.byPhone.getMany(unique, async (misses) => {
      const loaded = new Map<string, CallContact | null>();
      for (let i = 0; i < misses.length; i += MAX_BATCH) {
        const batch = misses.slice(i, i + MAX_BATCH);
        const answer = await this.fetchBatch(batch);
        if (!answer) continue; // CRM unreachable — leave these uncached, retry next time
        for (const phone of batch) loaded.set(phone, answer[phone] ?? null);
      }
      return loaded;
    });
    return Object.fromEntries(found);
  }

  /**
   * Names for parties a call is already associated with. Separate cache from
   * the by-phone one: this is keyed by identity, which is exactly the point —
   * the number may since have moved to somebody else.
   */
  async resolveRefs(
    refs: Array<{ kind: 'contact' | 'company'; id: string }>,
  ): Promise<Record<string, string>> {
    const keys = [...new Set(refs.map((r) => `${r.kind}:${r.id}`))];
    if (!keys.length) return {};
    const found = await this.byRef.getMany(keys, async (misses) => {
      const loaded = new Map<string, string | null>();
      try {
        const asked = misses.slice(0, 200).map((key) => {
          const [kind, ...rest] = key.split(':');
          return { kind, id: rest.join(':') };
        });
        const res = await fetch(`${CRM_SERVICE_URL}/api/crm/contacts/internal/by-ids`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-internal-secret': INTERNAL_SECRET,
          },
          body: JSON.stringify({ refs: asked }),
        });
        if (!res.ok) return loaded;
        const body = (await res.json()) as {
          data?: Record<string, { name?: string }>;
        };
        for (const ref of asked) {
          const key = `${ref.kind}:${ref.id}`;
          loaded.set(key, body.data?.[key]?.name ?? null);
        }
      } catch (error) {
        this.logger.warn(
          `party name lookup failed: ${error instanceof Error ? error.message : error}`,
        );
      }
      return loaded;
    });
    return Object.fromEntries(found);
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
