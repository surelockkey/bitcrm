/**
 * The arithmetic of Workiz's "Add job item" row — Quantity · Price · Markup %
 * · Cost. Markup is the price over the cost (330 on a 35.18 cost is
 * 838.03 %); typing a markup prices the line from its cost. Pure, so the
 * popup's two-way boxes can be held to it.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

const positive = (n: number): boolean => Number.isFinite(n) && n > 0;

/** The markup in percent, 2 decimals; null without a positive cost. */
export function markupPct(price: number, cost: number): number | null {
  if (!positive(cost) || !Number.isFinite(price)) return null;
  return round2(((price - cost) / cost) * 100);
}

/** The price a cost and a markup make, to the cent; null without a positive cost. */
export function priceFromMarkup(cost: number, markup: number): number | null {
  if (!positive(cost) || !Number.isFinite(markup)) return null;
  return round2(cost * (1 + markup / 100));
}

/** What was typed in a money box as a non-negative amount; null when it is not one. */
export function amountOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * What was typed in the Price box: any finite amount, below zero too — a
 * credit line ("Approved Discount" −25), as Workiz allows; null when it is
 * not a number.
 */
export function signedAmountOf(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** A number as Workiz fills its boxes: two decimals, no thousands separator. */
export function money2(n: number): string {
  return round2(n).toFixed(2);
}
