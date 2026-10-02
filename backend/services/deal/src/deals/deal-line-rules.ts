import { BadRequestException } from '@nestjs/common';
import { type DealProduct, type Product } from '@bitcrm/types';

/** A price-book amount as a line stores it: a finite number, else 0. */
const amount = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

/**
 * A job line's costs, copied from the price book entry the server itself just
 * read from inventory — never from the request. Inventory leaves `costCompany`
 * out of every catalog answer for a caller without `financials.view` (the
 * technician, the dispatcher), so the client cannot be the source; and no
 * client ever sent anything but the catalog's own two numbers.
 */
export function catalogCosts(
  product: Pick<Product, 'costCompany' | 'costTech'>,
): { costCompany: number; costForTech: number } {
  return { costCompany: amount(product.costCompany), costForTech: amount(product.costTech) };
}

/**
 * Client-price adjustment band off the price book (story 5.05: ±15%) — the
 * same number as the web's `PRICE_BAND` (apps/web/features/deals/lib.ts).
 */
export const PRICE_BAND = 0.15;

/** Float slack at the band's edges, as the web's `isPriceInBand` allows. */
const BAND_EPSILON = 1e-6;

const usd = (n: number): string =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * A line carried over from Workiz, by either marker the importer sets:
 * `fulfillment: 'imported'` on the product lines, `priceSource: 'imported'`
 * on the service lines (which keep `fulfillment: 'service'`).
 */
export function isImportedLine(
  line?: Pick<DealProduct, 'fulfillment' | 'priceSource'> | null,
): boolean {
  return line?.fulfillment === 'imported' || line?.priceSource === 'imported';
}

/**
 * Whether the band judges this write. Every added line and every edit is
 * judged, except an imported Workiz line edited in place at the price Workiz
 * recorded — most historical lines sit outside today's band, and flagging
 * them would make them unsavable. The exemption waives the band for that
 * price only: a new price typed on the line, or a swap to another item, is
 * judged. The web dialog's rule (`priceBandApplies` + `price === storedPrice`).
 */
export function priceBandApplies(
  line: { productId: string; priceClient: number },
  existing?: Pick<DealProduct, 'productId' | 'priceClient' | 'fulfillment' | 'priceSource'> | null,
): boolean {
  return !(
    existing &&
    isImportedLine(existing) &&
    line.productId === existing.productId &&
    line.priceClient === existing.priceClient
  );
}

/**
 * The client price must stay within ±15% of the price book's `priceClient`
 * (400 otherwise). An item the price book holds no price for is not judged.
 */
export function assertPriceInBand(price: number, catalogPrice: unknown): void {
  if (typeof catalogPrice !== 'number' || !Number.isFinite(catalogPrice)) return;
  const min = catalogPrice * (1 - PRICE_BAND);
  const max = catalogPrice * (1 + PRICE_BAND);
  if (price >= min - BAND_EPSILON && price <= max + BAND_EPSILON) return;
  throw new BadRequestException(
    `Price must be between ${usd(min)} and ${usd(max)} (±15% of the price book)`,
  );
}

/**
 * A line's custom field values as stored: only filled text values; `undefined`
 * when none is left (the attribute is then not written at all).
 */
export function lineCustomAttributes(
  values?: Record<string, string | null | undefined> | null,
): Record<string, string> | undefined {
  if (!values || typeof values !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string' && value.trim()) out[name] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
