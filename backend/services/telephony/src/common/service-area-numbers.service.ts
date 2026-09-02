import { Injectable, Logger } from '@nestjs/common';

const DEAL_SERVICE_URL =
  process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** The catalog changes when somebody edits a market — minutes, not seconds. */
const CACHE_TTL_MS = 5 * 60_000;

export interface ServiceAreaNumber {
  id: string;
  name: string;
  active: boolean;
  /** The number clients in this market are dialled FROM. E.164, optional. */
  callerId?: string;
}

/**
 * The market → caller-id map, read from deal-service's internal service-area
 * listing.
 *
 * A read-side sibling of the write-only `DealLinkService`, and deliberately the
 * same shape: a bare `fetch` with `x-internal-secret`, cached, and best-effort.
 * A market whose number we cannot resolve falls through the caller-id chain
 * rather than failing the call — nobody's job stops because the catalog is slow.
 */
@Injectable()
export class ServiceAreaNumbersService {
  private readonly logger = new Logger(ServiceAreaNumbersService.name);
  private cache: { byId: Map<string, ServiceAreaNumber>; expiresAt: number } | null =
    null;

  /** The caller id configured for a market, if it has one. */
  async callerIdFor(serviceAreaId: string | undefined): Promise<string | undefined> {
    if (!serviceAreaId) return undefined;
    const byId = await this.load();
    return byId.get(serviceAreaId)?.callerId || undefined;
  }

  /** Every market, for the settings health check. */
  async listAll(): Promise<ServiceAreaNumber[]> {
    return [...(await this.load()).values()];
  }

  private async load(): Promise<Map<string, ServiceAreaNumber>> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.byId;

    try {
      const res = await fetch(
        `${DEAL_SERVICE_URL}/api/deals/service-areas/internal`,
        { headers: { 'x-internal-secret': INTERNAL_SECRET } },
      );
      if (!res.ok) {
        this.logger.warn(`service-area listing returned ${res.status}`);
        return this.cache?.byId ?? new Map();
      }
      const body = (await res.json()) as { data?: ServiceAreaNumber[] };
      const byId = new Map<string, ServiceAreaNumber>();
      for (const area of body.data ?? []) byId.set(area.id, area);
      this.cache = { byId, expiresAt: Date.now() + CACHE_TTL_MS };
      return byId;
    } catch (error) {
      this.logger.warn(
        `service-area listing failed: ${error instanceof Error ? error.message : error}`,
      );
      // Serve the stale map rather than nothing — a market number that was
      // right five minutes ago is a far better answer than the default line.
      return this.cache?.byId ?? new Map();
    }
  }
}
