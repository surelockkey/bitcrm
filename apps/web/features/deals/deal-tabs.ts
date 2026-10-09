import { invoiceHref } from "@/features/invoices/lib";

/**
 * Tabs of the job page, in display order; `?tab=` deep-links to one.
 * Workiz's order, Attachments always 5th. Workiz has no Invoice tab: a job's
 * invoice opens on its own page (`/invoices/[id]`, "← Job ID" back here).
 */
export const DEAL_TABS = ["details", "items", "payments", "estimates", "attachments"] as const;
export type DealTab = (typeof DEAL_TABS)[number];

export function parseDealTab(raw: string | string[] | undefined | null): DealTab | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (DEAL_TABS as readonly string[]).includes(v ?? "") ? (v as DealTab) : null;
}

export function visibleDealTabs(perms: {
  estimates: boolean;
  /** `payments.view` — the job's Payments tab (Workiz). Hidden unless granted. */
  payments?: boolean;
}): DealTab[] {
  return DEAL_TABS.filter(
    (t) => (t !== "payments" || perms.payments === true) && (t !== "estimates" || perms.estimates),
  );
}

/**
 * The page URL for a tab (+ open estimate). `details` is the default and
 * leaves no `tab` param; `estimate` only rides along on the Estimates tab.
 */
export function dealTabHref(current: string, tab: DealTab, estimateId: string | null): string {
  const url = new URL(current, "http://x");
  if (tab === "details") url.searchParams.delete("tab");
  else url.searchParams.set("tab", tab);
  if (tab === "estimates" && estimateId) url.searchParams.set("estimate", estimateId);
  else url.searchParams.delete("estimate");
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`;
}

/* ------------------------------------------------- the old Invoice tab */

/** `?tab=invoice` — a link to the Invoice tab the job page used to have. */
export function isLegacyInvoiceTab(raw: string | string[] | undefined | null): boolean {
  return (Array.isArray(raw) ? raw[0] : raw) === "invoice";
}

/**
 * Where such a link lands now: the job's invoice on its own page, or — while
 * the job has none (or the viewer may not see it) — the job itself, where
 * "Create Invoice" sits.
 */
export function legacyInvoiceTabTarget(dealId: string, invoice: { id: string } | null | undefined): string {
  return invoice ? invoiceHref(invoice) : `/deals/${encodeURIComponent(dealId)}`;
}
