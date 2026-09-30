import { type UsageKey } from './inventory-usage.types';

/**
 * Projection rows in the shared BitCRM_Inventory table, one partition per
 * month of the JOB's scheduled date — the date the report filters on, like
 * Workiz. Never one constant key (the CALL#ALL lesson).
 */
export const USAGE_PK_PREFIX = 'USAGE#';
/** A job's pointers: which row each of its products lives on now. */
export const USAGE_OF_PK_PREFIX = 'USAGE_OF#';
export const USAGE_OF_SK_PREFIX = 'PRODUCT#';

export function usagePartition(month: string): string {
  return `${USAGE_PK_PREFIX}${month}`;
}

/** Job-date order inside a month; deal and product ids keep rows of one day apart. */
export function usageSortKey(jobDate: string, dealId: string, productId: string): string {
  return `${jobDate}#${dealId}#${productId}`;
}

export function usageKey(jobDate: string, dealId: string, productId: string): UsageKey {
  return { PK: usagePartition(jobDate.slice(0, 7)), SK: usageSortKey(jobDate, dealId, productId) };
}

export function usagePointerKey(dealId: string, productId: string): UsageKey {
  return { PK: `${USAGE_OF_PK_PREFIX}${dealId}`, SK: `${USAGE_OF_SK_PREFIX}${productId}` };
}

/** What the report's `search` runs `contains` against: item, SKU, job number, client. */
export function usageSearchText(row: {
  productName?: string;
  sku?: string;
  dealNumber?: string;
  clientName?: string;
}): string {
  return [row.productName, row.sku, row.dealNumber, row.clientName]
    .filter((part) => typeof part === 'string' && part.trim() !== '')
    .join(' ')
    .toLowerCase();
}
