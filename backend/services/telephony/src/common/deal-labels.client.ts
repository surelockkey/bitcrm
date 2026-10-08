import { Injectable, Logger } from '@nestjs/common';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** deal-service's ceiling for `POST /deals/by-ids`. */
const BY_IDS_MAX = 100;
const CONCURRENCY = 4;
const SOURCES_TTL_MS = 5 * 60_000;

/**
 * Job numbers for the calls export's "Jobs & Leads" column, read AS THE
 * VIEWER: `POST /api/deals/by-ids` with their own bearer token, so
 * `deals.view` and its data scope decide which jobs they may see — the grid
 * reads the same route for the same column. A chunk that fails is simply
 * missing from the answer.
 */
@Injectable()
export class DealNumbersClient {
  private readonly logger = new Logger(DealNumbersClient.name);

  async numbers(ids: string[], authorization: string | undefined): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length || !authorization) return out;
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += BY_IDS_MAX) chunks.push(unique.slice(i, i + BY_IDS_MAX));
    let next = 0;
    const worker = async () => {
      for (;;) {
        const chunk = chunks[next];
        next += 1;
        if (!chunk) return;
        try {
          const res = await fetch(`${DEAL_SERVICE_URL}/api/deals/by-ids`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization },
            body: JSON.stringify({ ids: chunk }),
          });
          if (!res.ok) {
            this.logger.warn(`deals by-ids returned ${res.status}`);
            continue;
          }
          const body = (await res.json()) as { data?: Array<{ id?: string; dealNumber?: string | number }> };
          for (const d of body.data ?? []) {
            if (d.id && d.dealNumber !== undefined && d.dealNumber !== null) out.set(d.id, String(d.dealNumber));
          }
        } catch (error) {
          this.logger.warn(`deals by-ids failed: ${error instanceof Error ? error.message : error}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    return out;
  }
}

/**
 * Job-source names (Workiz's ad groups) for the export's "Ad Source" column,
 * from deal-service's catalog (`GET /api/deals/job-sources/internal`),
 * archived ones included so old calls keep their name. Cached briefly.
 */
@Injectable()
export class JobSourceNamesClient {
  private cache: { value: Map<string, string>; expiresAt: number } | null = null;

  async names(): Promise<Map<string, string>> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const res = await fetch(`${DEAL_SERVICE_URL}/api/deals/job-sources/internal`, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    if (!res.ok) throw new Error(`job-sources returned ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id?: string; name?: string }> };
    const value = new Map<string, string>();
    for (const s of body.data ?? []) if (s.id && s.name) value.set(s.id, s.name);
    this.cache = { value, expiresAt: Date.now() + SOURCES_TTL_MS };
    return value;
  }
}
