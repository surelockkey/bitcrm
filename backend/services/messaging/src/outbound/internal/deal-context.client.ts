import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { INTERNAL_FETCH, defaultFetch, type FetchLike } from './internal-fetch';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** A job's roster is an authorisation input, so it is not trusted for long. */
const DEAL_TTL_MS = 60_000;
/** The market catalog changes when somebody edits a market — minutes. */
const AREAS_TTL_MS = 5 * 60_000;

/** The slice of a deal the sender chain and the data-scope check read. */
export interface DealContext {
  id: string;
  contactId?: string;
  serviceAreaId?: string;
  sourceId?: string;
  assignedTechIds: string[];
  assignedDispatcherId?: string;
}

export interface ServiceAreaNumber {
  id: string;
  name: string;
  active: boolean;
  /** The number clients in this market are dialled (and texted) from. */
  callerId?: string;
}

/**
 * Reads from deal-service, the way telephony's `DealReadService` and
 * `ServiceAreaNumbersService` do (design §4.2 rungs 4–5, §2.2): bare
 * `fetch` + `x-internal-secret`, short caches, best-effort for sender
 * selection. `find()` returning `null` means "could not read it" as much as
 * "no such job" — a caller that authorises on it must refuse, not pass.
 */
@Injectable()
export class DealContextClient {
  private readonly logger = new Logger(DealContextClient.name);
  private readonly deals = new Map<string, { deal: DealContext | null; expiresAt: number }>();
  private areas: { byId: Map<string, ServiceAreaNumber>; expiresAt: number } | null = null;

  constructor(
    @Optional() @Inject(INTERNAL_FETCH) private readonly fetchImpl: FetchLike = defaultFetch,
  ) {}

  async find(dealId: string | undefined, now: number = Date.now()): Promise<DealContext | null> {
    if (!dealId) return null;
    const hit = this.deals.get(dealId);
    if (hit && hit.expiresAt > now) return hit.deal;

    try {
      const res = await this.fetchImpl(
        `${DEAL_SERVICE_URL}/api/deals/internal/${encodeURIComponent(dealId)}`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        if (res.status === 404) this.deals.set(dealId, { deal: null, expiresAt: now + DEAL_TTL_MS });
        else this.logger.warn(`deal ${dealId} lookup returned ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { data?: Partial<DealContext> };
      if (!body.data?.id) return null;
      const deal: DealContext = {
        id: body.data.id,
        contactId: body.data.contactId,
        serviceAreaId: body.data.serviceAreaId,
        sourceId: body.data.sourceId,
        assignedTechIds: body.data.assignedTechIds ?? [],
        assignedDispatcherId: body.data.assignedDispatcherId,
      };
      this.deals.set(dealId, { deal, expiresAt: now + DEAL_TTL_MS });
      return deal;
    } catch (error) {
      this.logger.warn(`deal ${dealId} lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /** The caller id configured for a market, if it has one. */
  async serviceAreaCallerId(serviceAreaId: string | undefined, now: number = Date.now()): Promise<string | undefined> {
    if (!serviceAreaId) return undefined;
    const byId = await this.loadAreas(now);
    return byId.get(serviceAreaId)?.callerId || undefined;
  }

  private async loadAreas(now: number): Promise<Map<string, ServiceAreaNumber>> {
    if (this.areas && this.areas.expiresAt > now) return this.areas.byId;
    try {
      const res = await this.fetchImpl(`${DEAL_SERVICE_URL}/api/deals/service-areas/internal`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
      });
      if (!res.ok) {
        this.logger.warn(`service-area listing returned ${res.status}`);
        return this.areas?.byId ?? new Map();
      }
      const body = (await res.json()) as { data?: ServiceAreaNumber[] };
      const byId = new Map<string, ServiceAreaNumber>();
      for (const area of body.data ?? []) byId.set(area.id, area);
      this.areas = { byId, expiresAt: now + AREAS_TTL_MS };
      return byId;
    } catch (error) {
      this.logger.warn(`service-area listing failed: ${error instanceof Error ? error.message : error}`);
      return this.areas?.byId ?? new Map();
    }
  }
}
