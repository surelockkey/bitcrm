/** What a walked call row may carry about its job's total. */
export interface DealTotalRow {
  dealId?: unknown;
  dealTotal?: unknown;
  dealTotalAt?: unknown;
}

/**
 * The job totals the walked call rows already carry (`dealTotal`, stamped
 * when the call was linked and refreshed from deal-events) — so a report asks
 * deal-service only for the jobs whose rows have none yet (rows from before
 * the stamp, until `backfill:call-deal-totals` has run).
 *
 * Several calls of one job may carry different stamps (an event that reached
 * one row before the other); the freshest `dealTotalAt` wins.
 */
export class StoredDealTotals {
  private readonly known = new Map<string, { total: number; at: string }>();

  add(row: DealTotalRow): void {
    const dealId = row.dealId;
    const total = row.dealTotal;
    if (typeof dealId !== 'string' || !dealId) return;
    if (typeof total !== 'number' || !Number.isFinite(total)) return;
    const at = typeof row.dealTotalAt === 'string' ? row.dealTotalAt : '';
    const held = this.known.get(dealId);
    if (!held || at > held.at) this.known.set(dealId, { total, at });
  }

  /** Deal id → the stored total. */
  get totals(): Map<string, number> {
    return new Map([...this.known].map(([id, v]) => [id, v.total]));
  }

  /** The ids no walked row carried a total for. */
  missing(ids: readonly string[]): string[] {
    return ids.filter((id) => !this.known.has(id));
  }

  /** The stored totals with `fetched` laid over them. */
  merged(fetched: ReadonlyMap<string, number>): Map<string, number> {
    const out = this.totals;
    fetched.forEach((v, k) => out.set(k, v));
    return out;
  }
}
