import { describe, expect, it } from "vitest";
import type { PortalDocumentSummary } from "@bitcrm/types";
import {
  PublicApiError,
  businessAddressLine,
  businessInitials,
  formatMoney,
  formatYmd,
  isInvalidPortalError,
  outstanding,
  statusMeta,
  telHref,
  unwrapEnvelope,
  websiteHref,
} from "./lib";

const inv = (over: Partial<PortalDocumentSummary>): PortalDocumentSummary => ({
  kind: "invoice",
  id: "d1",
  number: "1",
  date: "2026-09-01",
  status: "due",
  total: 100,
  balanceDue: 100,
  sent: true,
  ...over,
});

describe("unwrapEnvelope", () => {
  it("unwraps success and reads messages / business names from the usual error shapes", () => {
    expect(unwrapEnvelope({ success: true, data: { a: 1 } })).toEqual({ ok: true, data: { a: 1 } });
    expect(unwrapEnvelope({ success: false, message: "nope" })).toEqual({ ok: false, message: "nope" });
    expect(unwrapEnvelope({ success: false, error: { message: "deep", businessName: "Acme" } })).toEqual({
      ok: false,
      message: "deep",
      businessName: "Acme",
    });
    expect(unwrapEnvelope(null)).toEqual({ ok: false, message: undefined });
  });
});

describe("isInvalidPortalError", () => {
  it("is true for dead-link statuses only", () => {
    expect(isInvalidPortalError(new PublicApiError(404, "x"))).toBe(true);
    expect(isInvalidPortalError(new PublicApiError(410, "x"))).toBe(true);
    expect(isInvalidPortalError(new PublicApiError(429, "x"))).toBe(false);
    expect(isInvalidPortalError(new PublicApiError(0, "x"))).toBe(false);
    expect(isInvalidPortalError(new Error("x"))).toBe(false);
  });
});

describe("formatting", () => {
  it("formats money and days without a timezone shift", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatYmd("2026-09-01")).toBe("Sep 1, 2026");
    expect(formatYmd(undefined)).toBe("—");
    expect(formatYmd("garbage")).toBe("—");
  });

  it("builds tel / web links, initials and address lines", () => {
    expect(telHref("+1 (404) 555-0100")).toBe("tel:+14045550100");
    expect(telHref("404-555-0100")).toBe("tel:4045550100");
    expect(websiteHref("acme.test")).toBe("https://acme.test");
    expect(websiteHref("http://acme.test")).toBe("http://acme.test");
    expect(businessInitials("Sure Lock Key")).toBe("SL");
    expect(businessInitials("  ")).toBe("•");
    expect(businessAddressLine({ street: "1 Main St", unit: "2", city: "Hartford", state: "CT", zip: "06103" } as never)).toBe(
      "1 Main St, 2, Hartford, CT 06103",
    );
    expect(businessAddressLine(undefined)).toBe("");
  });
});

describe("outstanding", () => {
  it("sums what is still owed on open invoices and flags overdue ones", () => {
    const docs = [
      inv({ id: "a", balanceDue: 40 }),
      inv({ id: "b", status: "overdue", balanceDue: 60 }),
      inv({ id: "c", status: "paid", balanceDue: 0 }),
      { ...inv({ id: "e" }), kind: "estimate" as const, status: "pending" as const, balanceDue: 999 },
    ];
    expect(outstanding(docs)).toEqual({ total: 100, count: 2, overdue: true });
    expect(outstanding([inv({ status: "paid", balanceDue: 0 })])).toEqual({ total: 0, count: 0, overdue: false });
  });
});

describe("statusMeta", () => {
  it("labels invoices and estimates and survives an unknown status", () => {
    expect(statusMeta({ kind: "invoice", status: "overdue" }).label).toBe("Overdue");
    expect(statusMeta({ kind: "estimate", status: "approved" }).label).toBe("Approved");
    expect(statusMeta({ kind: "invoice", status: "mystery" as never }).label).toBe("mystery");
  });
});
