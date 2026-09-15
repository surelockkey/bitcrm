import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

/** Injection token for the HTTP fetch — swapped in unit tests. */
export const DEAL_FETCH = Symbol('DEAL_FETCH');

/**
 * The slice of a deal the inbox needs: who the job is with and who is on it.
 * Read from deal-service's internal API (`GET /deals/internal/:id`,
 * `GET /deals/internal/by-tech/:techId`).
 */
export interface DealForMessaging {
  id: string;
  dealNumber?: string;
  contactId?: string;
  companyId?: string;
  assignedTechIds: string[];
  assignedDispatcherId?: string;
  superStatus?: string;
}

const CACHE_TTL_MS = 60_000;

type Fetch = typeof fetch;

/**
 * Deal reads for authorisation and for the job tab, cached 60 s like
 * telephony's `DealReadService`. Both readers answer `null` when the deal
 * service cannot be reached — callers that authorise on the answer must
 * treat that as a refusal (an outage is exactly when a removed technician
 * and a current one look alike).
 */
@Injectable()
export class DealReadService {
  private readonly logger = new Logger(DealReadService.name);
  private readonly byId = new Map<string, { deal: DealForMessaging | null; expiresAt: number }>();
  private readonly byTech = new Map<string, { deals: DealForMessaging[]; expiresAt: number }>();
  private readonly fetchImpl: Fetch;

  constructor(@Optional() @Inject(DEAL_FETCH) fetchImpl?: Fetch) {
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  /** One job. `null` = not found *or* unreachable; a 404 is cached, a 5xx is not. */
  async find(dealId: string): Promise<DealForMessaging | null> {
    if (!dealId) return null;
    const hit = this.byId.get(dealId);
    if (hit && hit.expiresAt > Date.now()) return hit.deal;

    const body = await this.getJson<{ data?: DealForMessaging }>(
      `/api/deals/internal/${encodeURIComponent(dealId)}`,
      (status) => {
        if (status === 404) this.byId.set(dealId, { deal: null, expiresAt: Date.now() + CACHE_TTL_MS });
      },
    );
    const deal = body?.data ? normalise(body.data) : null;
    if (deal) this.byId.set(dealId, { deal, expiresAt: Date.now() + CACHE_TTL_MS });
    return deal;
  }

  /**
   * The jobs a technician is on (deal-service returns the 100 most recent
   * from TechIndex). `null` when the deal service could not answer.
   */
  async listByTech(techId: string): Promise<DealForMessaging[] | null> {
    if (!techId) return [];
    const hit = this.byTech.get(techId);
    if (hit && hit.expiresAt > Date.now()) return hit.deals;

    const body = await this.getJson<{ data?: DealForMessaging[] }>(
      `/api/deals/internal/by-tech/${encodeURIComponent(techId)}`,
    );
    if (!body) return null;
    const deals = (body.data ?? []).map(normalise);
    this.byTech.set(techId, { deals, expiresAt: Date.now() + CACHE_TTL_MS });
    return deals;
  }

  /** Drop cached answers — after an assignment change is acted on. */
  forget(dealId: string): void {
    this.byId.delete(dealId);
  }

  private async getJson<T>(path: string, onStatus?: (status: number) => void): Promise<T | null> {
    const base = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET || '' },
      });
      if (!res.ok) {
        onStatus?.(res.status);
        if (res.status !== 404) this.logger.warn(`deal lookup ${path} returned ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (error) {
      this.logger.warn(`deal lookup ${path} failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }
}

function normalise(deal: DealForMessaging): DealForMessaging {
  return { ...deal, assignedTechIds: deal.assignedTechIds ?? [] };
}
