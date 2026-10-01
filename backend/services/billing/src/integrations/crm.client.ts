import { Inject, Injectable, Optional } from '@nestjs/common';
import { BusinessMetricsService } from '@bitcrm/shared';
import type { Company, Contact } from '@bitcrm/types';
import { CRM_SERVICE_URL } from '../common/constants/services.constants';
import { INTERNAL_FETCH, InternalHttp, defaultFetch, type FetchLike } from './internal-http';

/**
 * A contact as billing reads it. `paymentTerms` / `customTermsDays` are not on
 * the CRM `Contact` type today; they are honoured if CRM ever returns them.
 */
export type BillingContact = Contact & { paymentTerms?: string; customTermsDays?: number };

/**
 * CRM reads (existing internal routes):
 *   GET /api/crm/contacts/internal/:id
 *   GET /api/crm/companies/internal/:id
 *   POST /api/crm/contacts/internal/names-by-ids   (names only — the Payments report)
 *   POST /api/crm/contacts/by-ids                   (as the caller — the billing reports' client cells)
 */
@Injectable()
export class CrmClient {
  private readonly http: InternalHttp;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) fetchImpl?: FetchLike,
    @Optional() metrics?: BusinessMetricsService,
  ) {
    this.http = new InternalHttp('crm', CRM_SERVICE_URL, fetchImpl ?? defaultFetch, metrics);
  }

  getContact(id: string): Promise<BillingContact | null> {
    return this.http.request<BillingContact>(`/api/crm/contacts/internal/${encodeURIComponent(id)}`, {
      operation: 'getContact',
      nullOn404: true,
    });
  }

  /** `{ id, firstName, lastName }` per contact id (at most 100 per call; missing ids are absent). */
  async contactNamesByIds(ids: string[]): Promise<Array<{ id: string; firstName?: string; lastName?: string }>> {
    if (ids.length === 0) return [];
    return (
      (await this.http.request<Array<{ id: string; firstName?: string; lastName?: string }>>(
        '/api/crm/contacts/internal/names-by-ids',
        { method: 'POST', body: { ids: ids.slice(0, 100) }, operation: 'contactNamesByIds' },
      )) ?? []
    );
  }

  /**
   * Full contacts for a report the CALLER is reading — through the public,
   * permission-guarded `POST /api/crm/contacts/by-ids` with the caller's own
   * bearer, so `contacts.view` / `contacts.view_numbers` apply to them exactly
   * as on screen (numbers come back masked when they may not see them). At
   * most 100 ids; missing ids are absent. Without a bearer: `[]`.
   */
  async contactsAs(ids: string[], authorization: string | undefined): Promise<Contact[]> {
    if (!authorization || ids.length === 0) return [];
    return (
      (await this.http.request<Contact[]>('/api/crm/contacts/by-ids', {
        method: 'POST',
        body: { ids: ids.slice(0, 100) },
        headers: { authorization },
        operation: 'contactsAs',
      })) ?? []
    );
  }

  getCompany(id: string): Promise<Company | null> {
    return this.http.request<Company>(`/api/crm/companies/internal/${encodeURIComponent(id)}`, {
      operation: 'getCompany',
      nullOn404: true,
    });
  }
}
