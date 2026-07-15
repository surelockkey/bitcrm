import { Injectable, Logger } from '@nestjs/common';
import { SearchType } from '@bitcrm/types';

const CRM_SERVICE_URL = process.env.CRM_SERVICE_URL || 'http://localhost:4002';
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INVENTORY_SERVICE_URL =
  process.env.INVENTORY_SERVICE_URL || 'http://localhost:4004';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';

/** Types whose authoritative entity can be fetched by id over internal HTTP. */
const ENDPOINTS: Partial<Record<SearchType, (id: string) => string>> = {
  deal: (id) => `${DEAL_SERVICE_URL}/api/deals/internal/${id}`,
  contact: (id) => `${CRM_SERVICE_URL}/api/crm/contacts/internal/${id}`,
  company: (id) => `${CRM_SERVICE_URL}/api/crm/companies/internal/${id}`,
  user: (id) => `${USER_SERVICE_URL}/api/users/internal/${id}`,
  product: (id) => `${INVENTORY_SERVICE_URL}/api/inventory/products/internal/${id}`,
  warehouse: (id) => `${INVENTORY_SERVICE_URL}/api/inventory/warehouses/internal/${id}`,
  container: (id) => `${INVENTORY_SERVICE_URL}/api/inventory/containers/internal/${id}`,
  transfer: (id) => `${INVENTORY_SERVICE_URL}/api/inventory/transfers/internal/${id}`,
};

/** Signals a type the fetcher can't resolve by id (e.g. assembled `technician`). */
export class UnsupportedEntityError extends Error {}

/**
 * Fetches the authoritative entity for a search doc from its owning service.
 * Returns the entity, `null` when it 404s (→ caller deletes the doc), and throws
 * UnsupportedEntityError for types with no single-entity endpoint (→ backfill
 * territory, caller should skip rather than delete).
 */
@Injectable()
export class EntityFetcher {
  private readonly logger = new Logger(EntityFetcher.name);

  async fetch(type: SearchType, id: string): Promise<any | null> {
    const build = ENDPOINTS[type];
    if (!build) {
      throw new UnsupportedEntityError(`No fetch endpoint for type "${type}"`);
    }
    const res = await fetch(build(id), {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`Fetch ${type}#${id} failed: HTTP ${res.status}`);
    }
    const body = await res.json();
    // Internal endpoints return either the entity or an ApiResponse { data }.
    return (body as any)?.data ?? body;
  }
}
