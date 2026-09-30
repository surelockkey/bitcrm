import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';
import { BusinessMetricsService } from '@bitcrm/shared';
import { type BusinessProfile } from '@bitcrm/types';
import { BILLING_SERVICE_URL, INTERNAL_SERVICE_SECRET } from '../constants/services.constants';

const CACHE_TTL_MS = 60_000;
const TIMEOUT_MS = 3_000;

/**
 * The deal service's view of billing's companies (business profiles), read
 * from `GET /api/billing/business-profiles/internal`.
 *
 * Billing owns companies, but a billing outage must never block creating or
 * editing a job: an unreachable billing service makes `list()` return null,
 * and `resolve()` then accepts the id as given (no snapshot name) with a
 * warning. Successful reads are cached for 60s per process.
 */
@Injectable()
export class BusinessProfilesClient {
  private readonly logger = new Logger(BusinessProfilesClient.name);
  private readonly client: AxiosInstance;
  private cache: { at: number; items: BusinessProfile[] } | null = null;

  constructor(@Optional() private readonly businessMetrics?: BusinessMetricsService) {
    this.client = axios.create({
      baseURL: BILLING_SERVICE_URL,
      headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET },
      timeout: TIMEOUT_MS,
    });
  }

  /** Every company (archived included), or null when billing can't be reached. */
  async list(opts: { fresh?: boolean } = {}): Promise<BusinessProfile[] | null> {
    if (!opts.fresh && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.items;
    }
    const timer = this.businessMetrics?.internalHttpDuration?.startTimer({
      target_service: 'billing',
      operation: 'listBusinessProfiles',
    });
    try {
      const response = await this.client.get('/api/billing/business-profiles/internal');
      timer?.();
      const items = (response?.data?.data ?? []) as BusinessProfile[];
      this.cache = { at: Date.now(), items };
      return items;
    } catch (error) {
      timer?.();
      this.businessMetrics?.internalHttpErrors?.inc({
        target_service: 'billing',
        operation: 'listBusinessProfiles',
      });
      this.logger.warn(`Billing company list unavailable: ${(error as Error).message}`);
      return null;
    }
  }

  clearCache(): void {
    this.cache = null;
  }

  /** The active default company, or null (none, or billing unreachable). */
  async findDefault(): Promise<BusinessProfile | null> {
    const items = await this.list();
    return items?.find((p) => p.isDefault && p.active) ?? null;
  }

  /**
   * Validate a company id and return what a job snapshots. Unknown ids (after
   * one fresh re-read, so a company created seconds ago is found) and — unless
   * `allowInactive` — archived companies are 400s. Billing unreachable → the id
   * is accepted without a name.
   */
  async resolve(
    id: string,
    opts: { allowInactive?: boolean } = {},
  ): Promise<{ id: string; name?: string }> {
    let items = await this.list();
    if (items === null) {
      this.logger.warn(`Accepting company ${id} unverified: billing is unreachable`);
      return { id };
    }
    let found = items.find((p) => p.id === id);
    if (!found) {
      items = await this.list({ fresh: true });
      if (items === null) return { id };
      found = items.find((p) => p.id === id);
    }
    if (!found) throw new BadRequestException(`Company ${id} not found`);
    if (!found.active && !opts.allowInactive) {
      throw new BadRequestException(`Company "${found.name}" is archived`);
    }
    return { id: found.id, name: found.name };
  }
}
