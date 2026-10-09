import { describe, expect, it } from "vitest";
import { hubTiles, REPORT_TILES } from "./report-tiles";

/**
 * The 14 Workiz reports the business kept (2026-09-25, confirmed 2026-10-01),
 * in the order Workiz's hub lays them out (rep_hub_wz_01_default, row by row
 * with the dropped ones taken out).
 */
const KEPT = [
  "Jobs", "Job Statistics", "Payments", "Activity",
  "Estimates", "Invoices", "Aging invoices",
  "Items and services", "Website requests",
  "Tax", "Call Tracking", "Inventory Usage",
  "Franchise Report", "Commissions (Legacy)",
];

/** Where each kept report lives in BitCRM — or will, once its page lands. */
const ROUTES: Record<string, string> = {
  Jobs: "/reports/jobs",
  "Job Statistics": "/reports/job-statistics",
  Payments: "/reports/payments",
  Activity: "/reports/activity",
  // Workiz's tiles open its Estimates and Invoices list pages (/root/estimates,
  // /root/invoices — rep_hub_wz_07_*_target), which are ours too.
  Estimates: "/estimates",
  Invoices: "/invoices",
  "Aging invoices": "/reports/aging-invoices",
  "Items and services": "/reports/items",
  Tax: "/reports/tax",
  "Call Tracking": "/reports/call-tracking",
  "Inventory Usage": "/reports/inventory-usage",
  "Commissions (Legacy)": "/reports/commission",
};

/** Every report page BitCRM has today. */
const BUILT = [
  "/reports/jobs", "/reports/job-statistics", "/reports/payments", "/reports/activity",
  "/estimates", "/invoices", "/reports/aging-invoices", "/reports/items",
  "/reports/tax", "/reports/call-tracking", "/reports/commission",
];

const nobodyRefused = () => false;
const names = (tiles: readonly { name: string }[]) => tiles.map((t) => t.name);

describe("REPORT_TILES", () => {
  it("lists the 14 kept reports in Workiz's order", () => {
    expect(names(REPORT_TILES)).toEqual(KEPT);
  });

  it("points each at its BitCRM page; Website requests and Franchise Report have none", () => {
    expect(Object.fromEntries(REPORT_TILES.filter((t) => t.href).map((t) => [t.name, t.href]))).toEqual(ROUTES);
    expect(names(REPORT_TILES.filter((t) => !t.href))).toEqual(["Website requests", "Franchise Report"]);
  });
});

describe("hubTiles", () => {
  it("shows only the reports whose page is in the build, in Workiz's order", () => {
    expect(names(hubTiles({ built: BUILT, denied: nobodyRefused }))).toEqual([
      "Jobs", "Job Statistics", "Payments", "Activity",
      "Estimates", "Invoices", "Aging invoices",
      "Items and services", "Tax", "Call Tracking", "Commissions (Legacy)",
    ]);
  });

  it("never shows a report without a page — no dead tiles", () => {
    const shown = names(hubTiles({ built: BUILT, denied: nobodyRefused }));
    for (const name of ["Website requests", "Inventory Usage", "Franchise Report"]) expect(shown).not.toContain(name);
  });

  it("turns a tile on once its page is in the build", () => {
    const shown = names(hubTiles({ built: [...BUILT, "/reports/inventory-usage"], denied: nobodyRefused }));
    expect(shown).toContain("Inventory Usage");
    expect(shown.indexOf("Inventory Usage")).toBe(shown.indexOf("Call Tracking") + 1);
  });

  it("without the build's list, counts every route as built (the server could not read the app)", () => {
    expect(names(hubTiles({ denied: nobodyRefused }))).toEqual(Object.keys(ROUTES));
  });

  it("leaves out the reports the viewer may not open, as Workiz does", () => {
    const refused = new Set(["payments.view", "invoices.view", "financials.view", "calls.view", "commission.view", "estimates.view"]);
    const shown = names(hubTiles({ built: BUILT, denied: (r, a) => refused.has(`${r}.${a}`) }));
    expect(shown).toEqual(["Jobs", "Job Statistics", "Activity", "Items and services"]);
  });
});
