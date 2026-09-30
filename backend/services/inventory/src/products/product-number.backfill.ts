/** The attributes of a stored product row the number backfill decides on. */
export interface ProductNumberRow {
  PK: string;
  number?: unknown;
  externalId?: unknown;
}

export interface ProductNumberPlan {
  /** Imported rows and the Workiz item id each one takes as its number. */
  imported: Array<{ PK: string; number: number }>;
  /** Rows that get the next counter value, in scan order. */
  pending: string[];
  /** The highest number already taken or about to be, so the counter can be moved past it. */
  max: number;
}

const WORKIZ_ITEM_ID = /^workiz:item:(\d+)$/;

/**
 * The Workiz item id behind an importer `externalId`, or undefined for any
 * other shape. Pure, so the backfill's decision can be tested without DynamoDB.
 */
export function numberFromExternalId(externalId: unknown): number | undefined {
  if (typeof externalId !== 'string') return undefined;
  const match = WORKIZ_ITEM_ID.exec(externalId);
  return match ? Number(match[1]) : undefined;
}

/**
 * Who gets which number. A row that already has one is left alone (and still
 * raises the ceiling); an imported row takes its Workiz item id; everything
 * else waits for the counter, which the caller first raises to `max`.
 */
export function planProductNumbers(rows: ProductNumberRow[]): ProductNumberPlan {
  const plan: ProductNumberPlan = { imported: [], pending: [], max: 0 };

  for (const row of rows) {
    if (typeof row.number === 'number') {
      plan.max = Math.max(plan.max, row.number);
      continue;
    }
    const imported = numberFromExternalId(row.externalId);
    if (imported !== undefined) {
      plan.imported.push({ PK: row.PK, number: imported });
      plan.max = Math.max(plan.max, imported);
      continue;
    }
    plan.pending.push(row.PK);
  }

  return plan;
}
