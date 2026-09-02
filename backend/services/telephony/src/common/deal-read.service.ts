import { Injectable, Logger } from '@nestjs/common';

const DEAL_SERVICE_URL =
  process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/**
 * Short: the roster and the job's status are authorisation inputs, and a
 * technician removed from a job must stop reaching its client promptly.
 * deal-service caches the whole deal in Redis behind this anyway.
 */
const CACHE_TTL_MS = 60_000;

/** The slice of a deal telephony needs. */
export interface DealForCall {
  id: string;
  dealNumber?: string;
  contactId: string;
  companyId?: string;
  /** Which market's number this job's client is dialled from. */
  serviceAreaId?: string;
  serviceArea?: string;
  /** Peer roster — every technician on the job, equal. */
  assignedTechIds: string[];
  assignedDispatcherId?: string;
  superStatus?: string;
  closedAt?: string;
}

/**
 * Reads one job from deal-service.
 *
 * The read-side counterpart to `DealLinkService`, which only ever POSTs. Used
 * for two different things and the distinction matters:
 *
 *  - resolving the market caller id, where a stale answer is harmless;
 *  - AUTHORISING a call, where it is not. Callers that authorise must treat a
 *    failure as a refusal, never as a pass — an outage is exactly when you
 *    cannot tell a current technician from a removed one.
 */
@Injectable()
export class DealReadService {
  private readonly logger = new Logger(DealReadService.name);
  private readonly cache = new Map<
    string,
    { deal: DealForCall | null; expiresAt: number }
  >();

  /** Null means "could not read it" — not "no such job". */
  async find(dealId: string): Promise<DealForCall | null> {
    if (!dealId) return null;

    const hit = this.cache.get(dealId);
    if (hit && hit.expiresAt > Date.now()) return hit.deal;

    try {
      const res = await fetch(
        `${DEAL_SERVICE_URL}/api/deals/internal/${encodeURIComponent(dealId)}`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        // A 404 is a real answer and worth caching; a 500 is not.
        if (res.status === 404) {
          this.cache.set(dealId, { deal: null, expiresAt: Date.now() + CACHE_TTL_MS });
        } else {
          this.logger.warn(`deal ${dealId} lookup returned ${res.status}`);
        }
        return null;
      }
      const body = (await res.json()) as { data?: DealForCall };
      const deal = body.data ?? null;
      if (deal) {
        deal.assignedTechIds = deal.assignedTechIds ?? [];
        this.cache.set(dealId, { deal, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return deal;
    } catch (error) {
      this.logger.warn(
        `deal ${dealId} lookup failed: ${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /** Drop a cached job — used after a roster change is acted on. */
  forget(dealId: string): void {
    this.cache.delete(dealId);
  }
}
