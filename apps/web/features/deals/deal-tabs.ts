/** Tabs of the job page, in display order; `?tab=` deep-links to one. */
export const DEAL_TABS = ["details", "items", "estimates", "invoice", "attachments", "messages"] as const;
export type DealTab = (typeof DEAL_TABS)[number];

export function parseDealTab(raw: string | string[] | undefined | null): DealTab | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (DEAL_TABS as readonly string[]).includes(v ?? "") ? (v as DealTab) : null;
}

export function visibleDealTabs(perms: { estimates: boolean; invoices: boolean; messages: boolean }): DealTab[] {
  return DEAL_TABS.filter(
    (t) =>
      (t !== "estimates" || perms.estimates) &&
      (t !== "invoice" || perms.invoices) &&
      (t !== "messages" || perms.messages),
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
