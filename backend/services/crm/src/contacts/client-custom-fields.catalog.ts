import { BadGatewayException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type CustomFieldDefinition, customFieldEntityType } from '@bitcrm/types';

/** The slice of a client custom field crm checks an answer against. */
export type ClientCustomFieldDef = Pick<
  CustomFieldDefinition,
  'id' | 'name' | 'type' | 'options' | 'active' | 'searchable'
>;

interface FetchAnswer {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type CatalogFetch = (url: string, init: { headers: Record<string, string> }) => Promise<FetchAnswer>;
export const CLIENT_CUSTOM_FIELDS_FETCH = Symbol('CLIENT_CUSTOM_FIELDS_FETCH');

/** A field made a moment ago in Settings is asked for afresh (`fresh`), so a minute is plenty. */
const TTL_MS = 60_000;

/**
 * The client custom fields (Workiz's Settings → Custom Fields → Client), as
 * crm needs them to check a contact's answers. The catalog is deal-service's —
 * one catalog, both tabs — read over its internal list
 * (`GET /api/deals/custom-fields/internal`) and cached a minute. A list that
 * cannot be read is an error (502), never an empty catalog: an empty one would
 * refuse every answer as "unknown".
 */
@Injectable()
export class ClientCustomFieldsCatalog {
  private readonly logger = new Logger(ClientCustomFieldsCatalog.name);
  private cached?: { defs: ClientCustomFieldDef[]; expiresAt: number };

  constructor(@Optional() @Inject(CLIENT_CUSTOM_FIELDS_FETCH) private readonly fetchImpl?: CatalogFetch) {}

  /** Every client field, archived ones included (`active: false` refuses new answers). */
  async list(options: { fresh?: boolean } = {}): Promise<ClientCustomFieldDef[]> {
    if (!options.fresh && this.cached && this.cached.expiresAt > Date.now()) return this.cached.defs;

    const base = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
    const fetchImpl = this.fetchImpl ?? (globalThis.fetch as unknown as CatalogFetch);
    let rows: unknown;
    try {
      const res = await fetchImpl(`${base}/api/deals/custom-fields/internal`, {
        headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET ?? '' },
      });
      if (!res.ok) throw new Error(`deal-service answered ${res.status}`);
      rows = ((await res.json()) as { data?: unknown })?.data;
      if (!Array.isArray(rows)) throw new Error('deal-service sent no list');
    } catch (error) {
      this.logger.warn(`Client custom fields could not be read: ${(error as Error).message}`);
      throw new BadGatewayException('Client custom fields could not be read — try again');
    }

    const defs = (rows as Array<CustomFieldDefinition>)
      .filter((f) => customFieldEntityType(f) === 'client')
      .map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        options: f.options ?? [],
        active: Boolean(f.active),
        searchable: Boolean(f.searchable),
      }));
    this.cached = { defs, expiresAt: Date.now() + TTL_MS };
    return defs;
  }
}
