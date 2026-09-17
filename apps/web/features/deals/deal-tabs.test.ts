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

  it("orders tabs and gates billing ones by permission", () => {
    expect(visibleDealTabs({ estimates: false, invoices: false, messages: false })).toEqual([
      "details", "items", "attachments",
    ]);
    expect(visibleDealTabs({ estimates: true, invoices: true, messages: true })).toEqual([
      "details", "items", "estimates", "invoice", "attachments", "messages",
    ]);
  });

  it("writes tab + estimate into the query string, dropping defaults", () => {
    expect(dealTabHref("/deals/d1?x=1", "details", null)).toBe("/deals/d1?x=1");
    expect(dealTabHref("/deals/d1?tab=items", "details", null)).toBe("/deals/d1");
    expect(dealTabHref("/deals/d1", "estimates", "e1")).toBe("/deals/d1?tab=estimates&estimate=e1");
    expect(dealTabHref("/deals/d1?tab=estimates&estimate=e1", "invoice", "e1")).toBe("/deals/d1?tab=invoice");
  });
});
