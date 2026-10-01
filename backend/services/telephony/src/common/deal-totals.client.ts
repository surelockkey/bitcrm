import { Injectable } from '@nestjs/common';

const DEAL_SERVICE_URL = process.env.DEAL_SERVICE_URL || 'http://localhost:4003';
const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET || '';
/** deal-service's ceiling per request (`DealTotalsDto`). */
const CHUNK = 1000;
const CONCURRENCY = 4;

/**
 * The totals of many jobs, from deal-service (`POST internal/deal-totals`) —
 * Call Tracking's revenue. Unlike the job lookups, a failure throws: a report
 * must not print $0 for a month because deal-service blinked.
 */
@Injectable()
export class DealTotalsClient {
  async totals(ids: string[]): Promise<Map<string, number>> {
    const unique = [...new Set(ids)];
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));
    const out = new Map<string, number>();
    let next = 0;
    const worker = async () => {
      for (;;) {
        const chunk = chunks[next];
        next += 1;
        if (!chunk) return;
        const res = await fetch(`${DEAL_SERVICE_URL}/api/deals/internal/deal-totals`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
          body: JSON.stringify({ ids: chunk }),
        });
        if (!res.ok) throw new Error(`deal-totals returned ${res.status}`);
        const body = (await res.json()) as { data?: Record<string, number> };
        for (const [id, total] of Object.entries(body.data ?? {})) {
          if (typeof total === 'number') out.set(id, total);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
    return out;
  }
}
