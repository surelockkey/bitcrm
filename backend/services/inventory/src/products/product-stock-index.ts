import { ProductType } from '@bitcrm/types';
import { productSearchName } from './products.constants';

/**
 * The sparse "inventory products" partition on GSI3 (OwnerIndex): every
 * stock-managed product (type `product`, `manageStock` not false — any
 * status), in name order. `GET /products?manageStock=true` without a category
 * Queries it instead of Scanning the whole shared table, whose ~46k rows the
 * Scan's read budget could not cover — the first page came back empty with a
 * cursor. ~3k rows, so a filtered Query reads it whole within the budget.
 * Container rows use `OWNER#…` and user containers `CONTAINER_USERS#…` on the
 * same index; the prefixes never meet.
 */
export const PRODUCT_STOCK_INDEX_PK = 'PRODUCTS#STOCK';

/** The attributes of a stored product row the partition is derived from. */
export interface StockIndexRow {
  PK: string;
  SK: string;
  id?: string;
  name?: string;
  type?: string;
  manageStock?: boolean | null;
  GSI3PK?: string;
  GSI3SK?: string;
  [key: string]: unknown;
}

export interface StockIndexKeys {
  GSI3PK: string;
  GSI3SK: string;
}

export type StockIndexChange = { set: StockIndexKeys } | { remove: true } | null;

const PRODUCT_PREFIX = 'PRODUCT#';

/** Absent (or cleared to null) means managed; a service never is. */
function isStockManaged(row: StockIndexRow): boolean {
  return row.type === ProductType.PRODUCT && row.manageStock !== false;
}

/**
 * The keys a product row belongs under, or null when it is not a
 * stock-managed product. Pure, so the repository and the backfill decide the
 * same way and the decision is tested without DynamoDB.
 */
export function expectedStockIndexKeys(row: StockIndexRow): StockIndexKeys | null {
  if (row.SK !== 'METADATA' || !row.PK.startsWith(PRODUCT_PREFIX)) return null;
  if (!isStockManaged(row)) return null;
  const id = row.id ?? row.PK.slice(PRODUCT_PREFIX.length);
  return {
    GSI3PK: PRODUCT_STOCK_INDEX_PK,
    GSI3SK: `${productSearchName(row.name ?? '')}#${id}`,
  };
}

/** What a row needs: its keys set (or corrected), removed, or nothing. */
export function stockIndexChange(row: StockIndexRow): StockIndexChange {
  const expected = expectedStockIndexKeys(row);
  if (expected) {
    return row.GSI3PK === expected.GSI3PK && row.GSI3SK === expected.GSI3SK ? null : { set: expected };
  }
  return row.GSI3PK === PRODUCT_STOCK_INDEX_PK ? { remove: true } : null;
}

/**
 * The condition a stock-index write carries: the row still holds the name,
 * type, flag and sort key it was judged on. A write that landed in between
 * (a rename, a flag flipped) has healed the row itself; overwriting it with
 * keys derived from the older values would file it wrongly until the next
 * edit, so the stale write is refused instead.
 */
export function stockIndexWriteCondition(row: StockIndexRow): {
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
  if (typeof row.type === 'string') {
    parts.push('#type = :seenType');
    values[':seenType'] = row.type;
  } else {
    parts.push('attribute_not_exists(#type)');
  }
  if (typeof row.manageStock === 'boolean') {
    parts.push('manageStock = :seenManage');
    values[':seenManage'] = row.manageStock;
  } else {
    parts.push('(attribute_not_exists(manageStock) OR attribute_type(manageStock, :nullType))');
    values[':nullType'] = 'NULL';
  }
  if (typeof row.GSI3SK === 'string') {
    parts.push('GSI3SK = :seenSk');
    values[':seenSk'] = row.GSI3SK;
  } else {
    parts.push('attribute_not_exists(GSI3SK)');
  }

  return {
    ConditionExpression: parts.join(' AND '),
    ExpressionAttributeNames: { '#name': 'name', '#type': 'type' },
    ExpressionAttributeValues: values,
  };
}

export interface StockIndexWrite {
  kind: 'set' | 'remove';
  Key: { PK: string; SK: string };
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues: Record<string, unknown>;
}

/**
 * The one conditional UpdateCommand input that files a row (or takes it off),
 * or null when the row is already right — what the repository sends after
 * every update and what `backfill:product-stock-index` sends per row.
 */
export function stockIndexWrite(row: StockIndexRow): StockIndexWrite | null {
  const change = stockIndexChange(row);
  if (!change) return null;
  const condition = stockIndexWriteCondition(row);
  const isSet = 'set' in change;
  return {
    kind: isSet ? 'set' : 'remove',
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: isSet ? 'SET GSI3PK = :stockPk, GSI3SK = :stockSk' : 'REMOVE GSI3PK, GSI3SK',
    ConditionExpression: condition.ConditionExpression,
    ExpressionAttributeNames: condition.ExpressionAttributeNames,
    ExpressionAttributeValues: {
      ...(isSet && { ':stockPk': change.set.GSI3PK, ':stockSk': change.set.GSI3SK }),
      ...condition.ExpressionAttributeValues,
    },
  };
}
