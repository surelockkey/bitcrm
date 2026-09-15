import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

export const PHONE_DIRECTORY_OPTIONS = Symbol('PHONE_DIRECTORY_OPTIONS');

export interface PhoneDirectoryOptions {
  crmServiceUrl?: string;
  userServiceUrl?: string;
  internalSecret?: string;
  /** Overridable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Per-request budget — the webhook has to answer Twilio within ~15 s (§4.3). */
  timeoutMs?: number;
}

/** A number found in the CRM — a person, or a company's main line. */
export interface DirectoryContact {
  kind: 'contact' | 'company';
  id: string;
  name?: string;
  companyId?: string;
}

/** A number belonging to one of our own people. */
export interface DirectoryUser {
  id: string;
  name?: string;
  roleId?: string;
}

/**
 * `null` is a definite miss; `'unreachable'` means the directory did not
 * answer (down, timeout, 5xx) and the caller must not treat the number as
 * unknown for good (§4.3: `needsResolution`).
 */
export type DirectoryLookup<T> = T | null | 'unreachable';

/**
 * Phone → party through the other services' internal APIs
 * (`x-internal-secret`), the same two endpoints telephony resolves callers
 * with (`contact-lookup.service.ts`, `user-phone-lookup.service.ts`):
 *
 *   POST {CRM_SERVICE_URL}/api/crm/contacts/internal/by-phones   { phones } → { data: { [phone]: {kind,id,firstName,lastName,companyId} } }
 *   POST {USER_SERVICE_URL}/api/users/internal/by-phones         { phones } → { data: { [phone]: {id,firstName,lastName,roleId} } }
 *
 * No in-memory cache: the `ADDR#` pointer written after a hit is the cache,
 * and a miss must be re-asked on the next text (the client may have been
 * created meanwhile).
 */
@Injectable()
export class PhoneDirectory {
  private readonly logger = new Logger(PhoneDirectory.name);
  private readonly crmServiceUrl: string;
  private readonly userServiceUrl: string;
  private readonly internalSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    @Optional() @Inject(PHONE_DIRECTORY_OPTIONS) opts: PhoneDirectoryOptions = {},
  ) {
    this.crmServiceUrl = opts.crmServiceUrl ?? process.env.CRM_SERVICE_URL ?? 'http://localhost:4002';
    this.userServiceUrl = opts.userServiceUrl ?? process.env.USER_SERVICE_URL ?? 'http://localhost:4001';
    this.internalSecret = opts.internalSecret ?? process.env.INTERNAL_SERVICE_SECRET ?? '';
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 3000;
  }

  async lookupUser(phone: string): Promise<DirectoryLookup<DirectoryUser>> {
    const data = await this.post<{ id: string; firstName?: string; lastName?: string; roleId?: string }>(
      `${this.userServiceUrl}/api/users/internal/by-phones`,
      phone,
      'user',
    );
    if (data === 'unreachable') return data;
    const u = data[phone];
    if (!u?.id) return null;
    return { id: u.id, name: fullName(u.firstName, u.lastName), roleId: u.roleId };
  }

  async lookupContact(phone: string): Promise<DirectoryLookup<DirectoryContact>> {
    const data = await this.post<{
      kind?: 'contact' | 'company';
      id: string;
      firstName?: string;
      lastName?: string;
      companyId?: string;
    }>(`${this.crmServiceUrl}/api/crm/contacts/internal/by-phones`, phone, 'crm');
    if (data === 'unreachable') return data;
    const c = data[phone];
    if (!c?.id) return null;
    return { kind: c.kind ?? 'contact', id: c.id, name: fullName(c.firstName, c.lastName), companyId: c.companyId };
  }

  private async post<T>(
    url: string,
    phone: string,
    target: string,
  ): Promise<Record<string, T | undefined> | 'unreachable'> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': this.internalSecret },
        body: JSON.stringify({ phones: [phone] }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(`${target} by-phones returned ${res.status}`);
        return 'unreachable';
      }
      const body = (await res.json()) as { data?: Record<string, T | undefined> };
      return body.data ?? {};
    } catch (error) {
      this.logger.warn(`${target} by-phones failed: ${error instanceof Error ? error.message : error}`);
      return 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }
}

const fullName = (first?: string, last?: string): string | undefined => {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || undefined;
};
