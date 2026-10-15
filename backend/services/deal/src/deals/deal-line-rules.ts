import { BadRequestException } from '@nestjs/common';
import {
  DataScope,
  ProductType,
  type DealProduct,
  type DealProductFulfillment,
  type Product,
} from '@bitcrm/types';

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
  product: Partial<Pick<Product, 'costCompany' | 'costTech'>>,
): { costCompany: number; costForTech: number } {
  return { costCompany: amount(product.costCompany), costForTech: amount(product.costTech) };
}

/**
 * What a job line costs the company — Workiz's "Cost" box in "Add job item",
 * prefilled from the price book and typed over by the office. Only a caller
 * with `financials.view` (`mayCost`) may send one: the technician's phone never
 * saw the number. Absent, a new line (or a swap to another item) takes the
 * price book's, and an in-place edit keeps the line's own — Workiz freezes the
 * cost on the line, so a quantity change does not pull the price book's again.
 * `costForTech` is never typed: the price book's, or the line's on an edit.
 */
export function lineCosts(
  product: Partial<Pick<Product, 'costCompany' | 'costTech'>>,
  request: { productId?: string; costCompany?: unknown },
  opts: { mayCost: boolean; existing?: Pick<DealProduct, 'productId' | 'costCompany' | 'costForTech'> | null },
): { costCompany: number; costForTech: number } {
  const inPlace = !!opts.existing && request.productId === opts.existing.productId;
  const base = inPlace
    ? { costCompany: amount(opts.existing!.costCompany), costForTech: amount(opts.existing!.costForTech) }
    : catalogCosts(product);
  const sent = request.costCompany;
  if (opts.mayCost && typeof sent === 'number' && Number.isFinite(sent) && sent >= 0) {
    return { ...base, costCompany: sent };
  }
  return base;
}

/**
 * A line an item group added (`priceSource: 'group'`), edited in place at the
 * group's price: the line still carries the group's price, so it keeps the
 * marker. A new price, or a swap to another item, makes it an ordinary line.
 * Provenance only — no rule judges a line's price (owner, 2026-10-15: anyone
 * may set any price, below zero too); the mobile app reads the marker.
 */
export function keepsGroupPrice(
  line: { productId: string; priceClient: number },
  existing: Pick<DealProduct, 'productId' | 'priceClient' | 'priceSource'>,
): boolean {
  return (
    existing.priceSource === 'group' &&
    line.productId === existing.productId &&
    line.priceClient === existing.priceClient
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

/**
 * Whether stock is counted for this product — inventory's own rule
 * (`ProductsService.isStockManaged`, `product-stock-index.ts`): a `product`
 * whose row does not say `manageStock: false`. An absent flag (everything
 * BitCRM itself wrote) is counted. Services never are.
 */
export function isStockManaged(product: Pick<Product, 'type' | 'manageStock'>): boolean {
  return product.type === ProductType.PRODUCT && product.manageStock !== false;
}

/**
 * Who the container rule binds: a caller whose `deals` data scope is
 * `assigned_only` — the technician, by the same rule `assertDealInScope`
 * applies to every job write. A wider scope is the office.
 */
export function isTechnicianScope(dealScope?: string): boolean {
  return dealScope === DataScope.ASSIGNED_ONLY;
}

type StockSide = Pick<DealProduct, 'productId' | 'quantity' | 'fulfillment' | 'sourceTechId'>;

/**
 * Whether an edit changes what the line takes from a van: another product,
 * another quantity, or another source (a van line turned to-order hands the
 * stock back). A line that never moved stock (`to_order`, `imported`,
 * `service`) and still does not is not a stock change.
 */
export function editChangesStock(existing: StockSide, next: StockSide): boolean {
  const source = (line: StockSide) =>
    (line.fulfillment ?? 'sourced') === 'sourced' ? `van:${line.sourceTechId ?? ''}` : 'none';
  return (
    next.productId !== existing.productId ||
    next.quantity !== existing.quantity ||
    source(next) !== source(existing)
  );
}

/**
 * The container rule (owner, 2026-10-02 — Workiz's): a technician puts a
 * stock-managed product on a job only out of HIS OWN container (`sourced`,
 * `sourceTechId` = him) — never `to_order`, never another van. That it holds
 * enough is inventory's deduction to refuse. Services and products whose
 * stock is not counted are exempt. 400 naming the product otherwise.
 */
export function assertFromOwnContainer(
  line: { name: string; fulfillment: DealProductFulfillment; sourceTechId?: string },
  product: Pick<Product, 'type' | 'manageStock'>,
  callerId: string,
): void {
  if (!isStockManaged(product)) return;
  if (line.fulfillment === 'sourced' && line.sourceTechId === callerId) return;
  throw new BadRequestException(`${line.name} isn't in your container`);
}
