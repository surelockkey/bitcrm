import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type DirectoryContact, type DirectoryLookup } from '../../inbound/phone-directory';

export const EMAIL_DIRECTORY_OPTIONS = Symbol('EMAIL_DIRECTORY_OPTIONS');

export interface EmailDirectoryOptions {
  crmServiceUrl?: string;
  internalSecret?: string;
  /** Overridable for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** How long a 404 on the route ("crm does not have it") is remembered. */
  unsupportedTtlMs?: number;
}

/**
 * Email → CRM party, the email counterpart of `PhoneDirectory`:
 *
 *   POST {CRM_SERVICE_URL}/api/crm/contacts/internal/by-emails  { emails } → { data: { [email]: {kind,id,firstName,lastName,companyId} } }
 *
 * crm-service does not expose this route today (only `by-phones`); the
 * client probes it anyway so the moment crm adds it inbound mail resolves
 * to contacts without a messaging change. A 404 means "no such route" and
 * is remembered for ten minutes (one probe per burst, not one per mail);
 * anything else that is not a 200 is `'unreachable'`, so the caller marks
 * the conversation `needsResolution` instead of treating the sender as a
 * stranger for good. No cache of hits: the `ADDR#` pointer written after
 * one is the cache.
 */
@Injectable()
export class EmailDirectory {
  private readonly logger = new Logger(EmailDirectory.name);
  private readonly crmServiceUrl: string;
  private readonly internalSecret: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly unsupportedTtlMs: number;
  private unsupportedUntil = 0;

  constructor(@Optional() @Inject(EMAIL_DIRECTORY_OPTIONS) opts: EmailDirectoryOptions = {}) {
    this.crmServiceUrl = opts.crmServiceUrl ?? process.env.CRM_SERVICE_URL ?? 'http://localhost:4002';
    this.internalSecret = opts.internalSecret ?? process.env.INTERNAL_SERVICE_SECRET ?? '';
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.unsupportedTtlMs = opts.unsupportedTtlMs ?? 10 * 60_000;
  }

  /** Whether the route was recently found missing (nothing is asked until the memory expires). */
  get routeUnsupported(): boolean {
    return this.unsupportedUntil > Date.now();
  }

  async lookupContact(email: string): Promise<DirectoryLookup<DirectoryContact>> {
    if (this.routeUnsupported) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.crmServiceUrl}/api/crm/contacts/internal/by-emails`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': this.internalSecret },
        body: JSON.stringify({ emails: [email] }),
        signal: controller.signal,
      });
      if (res.status === 404) {
        this.unsupportedUntil = Date.now() + this.unsupportedTtlMs;
        this.logger.log('crm has no contacts/internal/by-emails route; inbound mail resolves by ADDR# only for a while');
        return null;
      }
      if (!res.ok) {
        this.logger.warn(`crm by-emails returned ${res.status}`);
        return 'unreachable';
      }
      const body = (await res.json()) as {
        data?: Record<string, { kind?: 'contact' | 'company'; id: string; firstName?: string; lastName?: string; companyId?: string } | undefined>;
      };
      const c = body.data?.[email] ?? body.data?.[email.toLowerCase()];
      if (!c?.id) return null;
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || undefined;
      return { kind: c.kind ?? 'contact', id: c.id, name, companyId: c.companyId };
    } catch (error) {
      this.logger.warn(`crm by-emails failed: ${error instanceof Error ? error.message : error}`);
      return 'unreachable';
    } finally {
      clearTimeout(timer);
    }
  }
}
