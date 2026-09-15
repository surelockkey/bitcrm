import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from './internal-fetch';

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** What `POST /messages` needs of a contact to open its conversation. */
export interface ContactAddresses {
  id: string;
  phones: string[];
  emails: string[];
}

export interface PhoneOwner {
  kind: 'contact' | 'company';
  id: string;
}

/**
 * CRM look-ups for starting a conversation from the composer (design §7.1
 * `POST /conversations` semantics, exposed here as `POST /messages`):
 * a contact by id, and "who owns this number" through the same
 * `internal/by-phones` route telephony names call parties with. Look-up
 * only — never creates a contact. Failures read as "not found": the caller
 * then opens an `unknown` conversation, exactly as an inbound text from an
 * unreachable-CRM moment would (§4.3).
 */
@Injectable()
export class CrmContactsClient {
  private readonly logger = new Logger(CrmContactsClient.name);

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async getContact(contactId: string): Promise<ContactAddresses | null> {
    try {
      const res = await this.fetchImpl(
        `${CRM_SERVICE_URL}/api/crm/contacts/internal/${encodeURIComponent(contactId)}`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        if (res.status !== 404) this.logger.warn(`contact ${contactId} lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: { id?: string; phones?: string[]; emails?: string[] } | null;
      };
      if (!body.data?.id) return null;
      return {
        id: body.data.id,
        phones: body.data.phones ?? [],
        emails: (body.data.emails ?? []).map((e) => e.toLowerCase()),
      };
    } catch (error) {
      this.logger.warn(`contact ${contactId} lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /** The contact (people before companies) that owns an E.164 number. */
  async findByPhone(phone: string): Promise<PhoneOwner | null> {
    try {
      const res = await this.fetchImpl(`${CRM_SERVICE_URL}/api/crm/contacts/internal/by-phones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
        body: JSON.stringify({ phones: [phone] }),
      });
      if (!res.ok) {
        this.logger.warn(`phone lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as {
        data?: Record<string, { kind?: 'contact' | 'company'; id: string }>;
      };
      const match = body.data?.[phone] ?? Object.values(body.data ?? {})[0];
      return match?.id ? { kind: match.kind ?? 'contact', id: match.id } : null;
    } catch (error) {
      this.logger.warn(`phone lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}
