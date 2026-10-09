import { describe, expect, it } from "vitest";
import { dealTabHref, isLegacyInvoiceTab, legacyInvoiceTabTarget, parseDealTab, visibleDealTabs } from "./deal-tabs";

describe("deal tabs", () => {
  it("parses known tabs and rejects the rest", () => {
    expect(parseDealTab("estimates")).toBe("estimates");
    expect(parseDealTab("bogus")).toBeNull();
    expect(parseDealTab(undefined)).toBeNull();
    expect(parseDealTab(["items", "x"])).toBe("items");
  });

  it("has no Messages tab — job texts live in the Inbox", () => {
    expect(parseDealTab("messages")).toBeNull();
    expect(visibleDealTabs({ estimates: true, payments: true })).not.toContain("messages");
  });

  // Workiz's job page has no Invoice tab: "Create Invoice" / "View Invoice"
  // open the invoice on a page of its own (job_invoice_route_wz_XYB3JT_details).
  it("has no Invoice tab — a job's invoice opens on its own page", () => {
    expect(parseDealTab("invoice")).toBeNull();
    expect(visibleDealTabs({ estimates: true, payments: true })).not.toContain("invoice");
  });

  // Workiz: Attachments is always the 5th tab.
  it("orders tabs as Workiz does — Attachments 5th — and gates billing ones by permission", () => {
    expect(visibleDealTabs({ estimates: false })).toEqual(["details", "items", "attachments"]);
    expect(visibleDealTabs({ estimates: true })).toEqual(["details", "items", "estimates", "attachments"]);
  });

  it("shows the Payments tab (Workiz) next to Items only with payments.view", () => {
    expect(parseDealTab("payments")).toBe("payments");
    expect(visibleDealTabs({ estimates: true, payments: true })).toEqual([
      "details", "items", "payments", "estimates", "attachments",
    ]);
    expect(visibleDealTabs({ estimates: false, payments: false })).not.toContain("payments");
  });

  it("writes tab + estimate into the query string, dropping defaults", () => {
    expect(dealTabHref("/deals/d1?x=1", "details", null)).toBe("/deals/d1?x=1");
    expect(dealTabHref("/deals/d1?tab=items", "details", null)).toBe("/deals/d1");
    expect(dealTabHref("/deals/d1", "estimates", "e1")).toBe("/deals/d1?tab=estimates&estimate=e1");
    expect(dealTabHref("/deals/d1?tab=estimates&estimate=e1", "attachments", "e1")).toBe("/deals/d1?tab=attachments");
  });
});

/** Old links (`/deals/<id>?tab=invoice` in texts, bookmarks, reports) still land where the invoice now lives. */
describe("the old Invoice tab link", () => {
  it("is recognised from the raw query", () => {
    expect(isLegacyInvoiceTab("invoice")).toBe(true);
    expect(isLegacyInvoiceTab(["invoice"])).toBe(true);
    expect(isLegacyInvoiceTab("items")).toBe(false);
    expect(isLegacyInvoiceTab(undefined)).toBe(false);
  });

  it("goes to the job's invoice page, or to the job while it has none", () => {
    expect(legacyInvoiceTabTarget("d1", { id: "d1" })).toBe("/invoices/d1");
    expect(legacyInvoiceTabTarget("d1", null)).toBe("/deals/d1");
    expect(legacyInvoiceTabTarget("d 1", undefined)).toBe("/deals/d%201");
  });
});
