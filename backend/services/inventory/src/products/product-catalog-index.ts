import { BadRequestException } from '@nestjs/common';
import { productSearchName } from './products.constants';
import { decodeIndexCursor } from '../common/utils/index-cursor';

/**
 * The Price Book partition on GSI4 (TransferEntityIndex): EVERY product row —
 * products, services, Workiz `other` / `hours`, active and archived — in name
 * order. `GET /products` without a category and without `manageStock=true`
 * Queries it instead of Scanning the shared table (~46k rows), whose read
 * budget answered short or empty pages with a cursor. ~16k rows / ~16 MB on
 * dev, so a filtered page reads it with 1 MB reads (`PRODUCT_INDEX_READ_ROWS`).
 * Transfers use `ENTITY#…` and the inventory log `INVLOG#PRODUCT#…` on the same
 * index; the prefixes never meet, and no product row carried GSI4 keys before.
 */
export const PRODUCT_CATALOG_INDEX_PK = 'PRODUCTS#ALL';

/** A cursor of the catalog Query names the table keys and the GSI4 keys. */
export const CATALOG_CURSOR_KEYS = ['PK', 'SK', 'GSI4PK', 'GSI4SK'] as const;

/**
 * How much of the name orders the row. An index key holds at most 1 024 bytes
 * and a longer one rejects the whole write; 200 characters (≤ 800 bytes) keep
 * any name well inside that, and nothing sorts on the 201st character.
 */
const SORT_NAME_CHARS = 200;

/** The attributes of a stored product row the partition is derived from. */
export interface CatalogIndexRow {
  PK: string;
  SK: string;
  id?: string;
  name?: string;
  GSI4PK?: string;
  GSI4SK?: string;
  [key: string]: unknown;
}

export interface CatalogIndexKeys {
  GSI4PK: string;
  GSI4SK: string;
}

const PRODUCT_PREFIX = 'PRODUCT#';

function isProductRow(row: CatalogIndexRow): boolean {
  return row.SK === 'METADATA' && row.PK.startsWith(PRODUCT_PREFIX);
}

/**
 * The keys a product row belongs under, or null for a row that is not product
 * metadata. Every product belongs — any type, any status, any stock flag.
 * Pure, so the repository and the backfill decide the same way.
 */
export function expectedCatalogIndexKeys(row: CatalogIndexRow): CatalogIndexKeys | null {
  if (!isProductRow(row)) return null;
  const id = row.id ?? row.PK.slice(PRODUCT_PREFIX.length);
  const name = [...productSearchName(row.name ?? '')].slice(0, SORT_NAME_CHARS).join('');
  return { GSI4PK: PRODUCT_CATALOG_INDEX_PK, GSI4SK: `${name}#${id}` };
}

/**
 * The condition a catalog-index write carries: the row still holds the name
 * and the sort key it was judged on. A rename that landed in between files
 * the row itself; keys derived from the older name would file it wrongly
 * until the next edit, so the stale write is refused instead.
 */
export function catalogIndexWriteCondition(row: CatalogIndexRow): {
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
} {
  const parts = ['attribute_exists(PK)'];
  const values: Record<string, unknown> = {};

  if (typeof row.name === 'string') {
    parts.push('#name = :seenName');
    values[':seenName'] = row.name;
  } else {
    parts.push('attribute_not_exists(#name)');
  }
  if (typeof row.GSI4SK === 'string') {
    parts.push('GSI4SK = :seenCatalogSk');
    values[':seenCatalogSk'] = row.GSI4SK;
  } else {
    parts.push('attribute_not_exists(GSI4SK)');
  }

  return {
    ConditionExpression: parts.join(' AND '),
    ExpressionAttributeNames: { '#name': 'name' },
    ExpressionAttributeValues: values,
  };
}

export interface CatalogIndexWrite {
  Key: { PK: string; SK: string };
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

/**
 * The one conditional UpdateCommand input that files a product row (or
 * re-files it after a rename), or null when it is already right or is not a
 * product — what the repository sends after every update and what
 * `backfill:product-catalog-index` sends per row. A product never leaves the
 * partition, so there is no removal.
 */
export function catalogIndexWrite(row: CatalogIndexRow): CatalogIndexWrite | null {
  const expected = expectedCatalogIndexKeys(row);
  if (!expected) return null;
  if (row.GSI4PK === expected.GSI4PK && row.GSI4SK === expected.GSI4SK) return null;

  const condition = catalogIndexWriteCondition(row);
  return {
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET GSI4PK = :catalogPk, GSI4SK = :catalogSk',
    ConditionExpression: condition.ConditionExpression,
    ExpressionAttributeNames: condition.ExpressionAttributeNames,
    ExpressionAttributeValues: {
      ':catalogPk': expected.GSI4PK,
      ':catalogSk': expected.GSI4SK,
      ...condition.ExpressionAttributeValues,
    },
  };
}

export interface CatalogIndexPlan {
  writes: CatalogIndexWrite[];
  /** Product rows already carrying the right keys. */
  alreadyFiled: number;
  /** Rows the page held that are not product metadata (left alone). */
  notProducts: number;
}

/** What `backfill:product-catalog-index` does with one page of scanned rows. */
export function planCatalogIndexBackfill(rows: CatalogIndexRow[]): CatalogIndexPlan {
  const plan: CatalogIndexPlan = { writes: [], alreadyFiled: 0, notProducts: 0 };
  for (const row of rows) {
    if (!isProductRow(row)) {
      plan.notProducts += 1;
      continue;
    }
    const write = catalogIndexWrite(row);
    if (write) plan.writes.push(write);
    else plan.alreadyFiled += 1;
  }
  return plan;
}

/**
 * The start key of a catalog page. Decoded before any read: garbage, a
 * Scan-era cursor (table keys only), a stock-partition cursor or a GSI4 key
 * of another partition would make DynamoDB answer a ValidationException — a
 * 500 — so each is a 400 instead.
 */
export function decodeCatalogCursor(cursor: string | undefined): Record<string, unknown> | undefined {
  const key = decodeIndexCursor(cursor, CATALOG_CURSOR_KEYS);
  if (key && key.GSI4PK !== PRODUCT_CATALOG_INDEX_PK) throw new BadRequestException('Invalid cursor');
  return key;
}
