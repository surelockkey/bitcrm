import { DealStatus } from '@bitcrm/types';

/**
 * GSI11 NeedsInvoiceIndex — the jobs that still need an invoice, as a key:
 *
 *   GSI11PK = NEEDS_INVOICE
 *   GSI11SK = <createdAt>#DEAL#<id>        newest first with ScanIndexForward=false
 *
 * Sparse: on a deal's METADATA row exactly while it is live (`status =
 * active`), has at least one line (`itemCount > 0`) and carries no
 * `invoiceId` — the three terms the `needsInvoice` list filter has always
 * applied (`dealFilterExpression`), nothing more: a canceled job with lines
 * and no invoice is listed, as it always was. Billing's invoice summaries
 * count it and list it without a Scan of the whole table.
 *
 * Written by the repository alone — on `create` and on every `update` that
 * carries one of `NEEDS_INVOICE_INPUTS` — never by a caller. It is a derived
 * projection: `backfill:needs-invoice-index` reconciles it (sets the keys
 * where missing AND removes them where a row no longer qualifies).
 */
export const NEEDS_INVOICE_PK = 'NEEDS_INVOICE';

/**
 * The readiness row: `NEEDSINVOICEINDEX / STATE { readyAt, count }`, stamped
 * by `backfill:needs-invoice-index -- --apply` after a complete reconcile
 * (never by a dry run). Until it exists the readers keep their old paths —
 * the public list Scans, billing's internal routes answer 404 so billing
 * falls back — exactly as billing's `UNPAIDINDEX / STATE` gates UnpaidIndex.
 * Deploying before Terraform or before the backfill is therefore safe.
 */
export const NEEDS_INVOICE_STATE_KEY = { PK: 'NEEDSINVOICEINDEX', SK: 'STATE' } as const;

/** DynamoDB's answer to a Query on an index the table does not have (yet). */
export function isMissingIndexError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  return e?.name === 'ValidationException' && /index/i.test(e.message ?? '');
}

/** The row attributes the index is computed from. */
export const NEEDS_INVOICE_INPUTS: ReadonlySet<string> = new Set(['status', 'itemCount', 'invoiceId']);

export interface NeedsInvoiceKeys {
  GSI11PK: string;
  GSI11SK: string;
}

type Row = Record<string, unknown>;

/** The keys a row should carry, or nothing when it does not need an invoice. */
export function needsInvoiceKeys(row: Row): NeedsInvoiceKeys | undefined {
  if (row.status !== DealStatus.ACTIVE) return undefined;
  if (typeof row.itemCount !== 'number' || !(row.itemCount > 0)) return undefined;
  // `attribute_not_exists(invoiceId)`, as the filter has it.
  if (row.invoiceId !== undefined) return undefined;
  if (typeof row.id !== 'string' || typeof row.createdAt !== 'string') return undefined;
  return { GSI11PK: NEEDS_INVOICE_PK, GSI11SK: `${row.createdAt}#DEAL#${row.id}` };
}

export type NeedsInvoicePlan = { action: 'same' } | { action: 'set'; pk: string; sk: string } | { action: 'remove' };

/** What one row needs: nothing, its keys set, or its keys removed. */
export function planNeedsInvoice(row: Row): NeedsInvoicePlan {
  const keys = needsInvoiceKeys(row);
  if (keys) {
    return row.GSI11PK === keys.GSI11PK && row.GSI11SK === keys.GSI11SK
      ? { action: 'same' }
      : { action: 'set', pk: keys.GSI11PK, sk: keys.GSI11SK };
  }
  return row.GSI11PK === undefined && row.GSI11SK === undefined ? { action: 'same' } : { action: 'remove' };
}

/**
 * The UpdateCommand parts that apply a plan, guarded on the inputs exactly as
 * they were when the plan was made. A write that changed one of them since
 * (a line added while the invoice was linked) fails the condition instead of
 * landing keys computed from a row that no longer exists; the caller re-reads
 * and plans again.
 */
export function needsInvoiceWrite(
  row: Row,
  plan: Exclude<NeedsInvoicePlan, { action: 'same' }>,
): {
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const conditions = ['attribute_exists(PK)'];
  for (const attr of NEEDS_INVOICE_INPUTS) {
    names[`#ni_${attr}`] = attr;
    if (row[attr] === undefined) {
      conditions.push(`attribute_not_exists(#ni_${attr})`);
    } else {
      conditions.push(`#ni_${attr} = :ni_${attr}`);
      values[`:ni_${attr}`] = row[attr];
    }
  }
  if (plan.action === 'set') {
    values[':gsi11pk'] = plan.pk;
    values[':gsi11sk'] = plan.sk;
  }
  return {
    UpdateExpression: plan.action === 'set' ? 'SET GSI11PK = :gsi11pk, GSI11SK = :gsi11sk' : 'REMOVE GSI11PK, GSI11SK',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length && { ExpressionAttributeValues: values }),
  };
}
