import { describe, expect, it } from "vitest";
import { dealTabHref, parseDealTab, visibleDealTabs } from "./deal-tabs";

describe("deal tabs", () => {
  it("parses known tabs and rejects the rest", () => {
    expect(parseDealTab("invoice")).toBe("invoice");
    expect(parseDealTab("estimates")).toBe("estimates");
    expect(parseDealTab("bogus")).toBeNull();
    expect(parseDealTab(undefined)).toBeNull();
    expect(parseDealTab(["items", "x"])).toBe("items");
  });

  it("has no Messages tab — job texts live in the Inbox", () => {
    expect(parseDealTab("messages")).toBeNull();
    expect(visibleDealTabs({ estimates: true, invoices: true, payments: true })).not.toContain("messages");
  });

  it("orders tabs and gates billing ones by permission", () => {
    expect(visibleDealTabs({ estimates: false, invoices: false })).toEqual([
      "details", "items", "attachments",
    ]);
    expect(visibleDealTabs({ estimates: true, invoices: true })).toEqual([
      "details", "items", "estimates", "invoice", "attachments",
    ]);
  });

  it("shows the Payments tab (Workiz) next to Items only with payments.view", () => {
    expect(parseDealTab("payments")).toBe("payments");
    expect(visibleDealTabs({ estimates: true, invoices: true, payments: true })).toEqual([
      "details", "items", "payments", "estimates", "invoice", "attachments",
    ]);
    expect(visibleDealTabs({ estimates: false, invoices: false, payments: false })).not.toContain(
      "payments",
    );
  });

  it("writes tab + estimate into the query string, dropping defaults", () => {
    expect(dealTabHref("/deals/d1?x=1", "details", null)).toBe("/deals/d1?x=1");
    expect(dealTabHref("/deals/d1?tab=items", "details", null)).toBe("/deals/d1");
    expect(dealTabHref("/deals/d1", "estimates", "e1")).toBe("/deals/d1?tab=estimates&estimate=e1");
    expect(dealTabHref("/deals/d1?tab=estimates&estimate=e1", "invoice", "e1")).toBe("/deals/d1?tab=invoice");
  });
});
