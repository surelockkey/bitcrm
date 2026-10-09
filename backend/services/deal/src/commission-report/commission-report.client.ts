import { Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { BusinessMetricsService } from '@bitcrm/shared';
import type { CommissionConfig } from '@bitcrm/types';
import {
  BILLING_SERVICE_URL,
  CRM_SERVICE_URL,
  INTERNAL_SERVICE_SECRET,
  USER_SERVICE_URL,
} from '../common/constants/services.constants';
import type { LedgerPayment } from './workiz-commission.calc';

const TIMEOUT_MS = 10_000;
const LEDGERS_PER_CALL = 100;
const USERS_PER_CALL = 200;
const CONTACTS_PER_CALL = 100;

/** A lookup that failed is `null`, never an empty answer: the report must say so, not print zeros. */
export type Lookup<T> = Map<string, T> | null;

/**
 * What the commissions report needs from other services, over their
 * internal routes:
 *
 *   billing  POST /api/billing/payments/internal/by-deals      the ledgers of jobs done here
 *   user     POST /api/users/technicians/internal/commissions  rate version histories
 *   user     POST /api/users/internal/names-by-ids             technician names
 *   crm      POST /api/crm/contacts/internal/names-by-ids      client names (names only)
 */
@Injectable()
export class CommissionReportClient {
  private readonly logger = new Logger(CommissionReportClient.name);
  private readonly billing: AxiosInstance;
  private readonly user: AxiosInstance;
  private readonly crm: AxiosInstance;

  constructor(@Optional() private readonly metrics?: BusinessMetricsService) {
    const headers = { 'x-internal-secret': INTERNAL_SERVICE_SECRET };
    this.billing = axios.create({ baseURL: BILLING_SERVICE_URL, headers, timeout: TIMEOUT_MS });
    this.user = axios.create({ baseURL: USER_SERVICE_URL, headers, timeout: TIMEOUT_MS });
    this.crm = axios.create({ baseURL: CRM_SERVICE_URL, headers, timeout: TIMEOUT_MS });
  }

  /** Each job's payments; null when billing could not answer for all of them. */
  async ledgers(dealIds: string[]): Promise<Lookup<LedgerPayment[]>> {
    return this.chunked('billing', 'ledgersByDeals', dealIds, LEDGERS_PER_CALL, async (ids) => {
      const res = await this.billing.post('/api/billing/payments/internal/by-deals', { dealIds: ids });
      return Object.entries((res.data?.data ?? {}) as Record<string, LedgerPayment[]>);
    });
  }

  /** Each technician's commission versions; null when user-service could not answer. */
  async commissionHistories(userIds: string[]): Promise<Lookup<CommissionConfig[]>> {
    return this.chunked('user', 'commissionHistories', userIds, USERS_PER_CALL, async (ids) => {
      const res = await this.user.post('/api/users/technicians/internal/commissions', { userIds: ids });
      return Object.entries((res.data?.data ?? {}) as Record<string, CommissionConfig[]>);
    });
  }

  /**
   * The technician's name per user id as Workiz prints it — the imported
   * Workiz name ("(2) TX - Ricky Sledge") when the user has one, else "First
   * Last"; best effort — a failure leaves the names out.
   */
  async userNames(userIds: string[]): Promise<Map<string, string>> {
    const found = await this.chunked('user', 'userNames', userIds, USERS_PER_CALL, async (ids) => {
      const res = await this.user.post('/api/users/internal/names-by-ids', { userIds: ids });
      return this.names(res.data?.data);
    });
    return found ?? new Map();
  }

  /** Client names per contact id; best effort, names only (never numbers or emails). */
  async contactNames(contactIds: string[]): Promise<Map<string, string>> {
    const found = await this.chunked('crm', 'contactNames', contactIds, CONTACTS_PER_CALL, async (ids) => {
      const res = await this.crm.post('/api/crm/contacts/internal/names-by-ids', { ids });
      return this.names(res.data?.data);
    });
    return found ?? new Map();
  }

  private names(rows: unknown): Array<[string, string]> {
    if (!Array.isArray(rows)) return [];
    const out: Array<[string, string]> = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      if (!row || typeof row.id !== 'string') continue;
      const workiz = typeof row.workizName === 'string' ? row.workizName.trim() : '';
      const name = workiz || [row.firstName, row.lastName].filter((v) => typeof v === 'string' && v.trim()).join(' ').trim();
      if (name) out.push([row.id, name]);
    }
    return out;
  }

  private async chunked<T>(
    service: string,
    operation: string,
    ids: string[],
    size: number,
    call: (ids: string[]) => Promise<Array<[string, T]>>,
  ): Promise<Map<string, T> | null> {
    const unique = [...new Set(ids.filter(Boolean))];
    const out = new Map<string, T>();
    if (!unique.length) return out;
    const timer = this.metrics?.internalHttpDuration?.startTimer({ target_service: service, operation });
    try {
      for (let i = 0; i < unique.length; i += size) {
        for (const [id, value] of await call(unique.slice(i, i + size))) out.set(id, value);
      }
      timer?.();
      return out;
    } catch (error) {
      timer?.();
      this.metrics?.internalHttpErrors?.inc({ target_service: service, operation });
      this.logger.warn(`${service} ${operation} failed for ${unique.length} ids: ${(error as Error).message}`);
      return null;
    }
  }
}
