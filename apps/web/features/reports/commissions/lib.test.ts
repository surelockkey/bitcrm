import { describe, expect, it } from "vitest";
import type { CommissionReportRow } from "@bitcrm/types";
import {
  COMMISSION_DATE_PRESETS,
  cellText,
  commissionColumns,
  commissionPresetRange,
  commissionReportParams,
  formatDayTime,
  rateLabel,
  todayIn,
  visibleColumns,
} from "./lib";

describe("commissionPresetRange — Workiz's thirteen presets", () => {
  // Tuesday, 2026-09-29.
  const today = "2026-09-29";

  it("lists them in Workiz's order", () => {
    expect(COMMISSION_DATE_PRESETS.map((p) => p.label)).toEqual([
      "Custom",
      "Today",
      "Yesterday",
      "This week (Sun - Today)",
      "This week (Mon - Today)",
      "Last 7 days",
      "Last week (Sun - Sat)",
      "Last week (Mon - Sun)",
      "Last business week (Mon - Fri)",
      "Last 14 days",
      "This month",
      "Last 30 days",
      "Last month",
    ]);
  });

  it.each([
    ["today", "2026-09-29", "2026-09-29"],
    ["yesterday", "2026-09-28", "2026-09-28"],
    ["this_week_sun", "2026-09-27", "2026-09-29"],
    ["this_week_mon", "2026-09-28", "2026-09-29"],
    ["last_7_days", "2026-09-23", "2026-09-29"],
    ["last_week_sun", "2026-09-20", "2026-09-26"],
    ["last_week_mon", "2026-09-21", "2026-09-27"],
    ["last_business_week", "2026-09-21", "2026-09-25"],
    ["last_14_days", "2026-09-16", "2026-09-29"],
    ["this_month", "2026-09-01", "2026-09-29"],
    ["last_30_days", "2026-08-31", "2026-09-29"],
    ["last_month", "2026-08-01", "2026-08-31"],
  ] as const)("%s → %s … %s", (preset, from, to) => {
    expect(commissionPresetRange(preset, today)).toEqual({ from, to });
  });

  it("a Sunday is the last day of its Mon–Sun week and the first of its Sun–Sat one", () => {
    expect(commissionPresetRange("this_week_mon", "2026-09-27")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(commissionPresetRange("this_week_sun", "2026-09-27")).toEqual({ from: "2026-09-27", to: "2026-09-27" });
    expect(commissionPresetRange("last_week_mon", "2026-09-27")).toEqual({ from: "2026-09-14", to: "2026-09-20" });
  });

  it("custom leaves the days to the picker", () => {
    expect(commissionPresetRange("custom", today)).toEqual({});
  });
});

describe("todayIn", () => {
  it("is the business's day, not UTC's", () => {
    expect(todayIn("America/New_York", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-29");
    expect(todayIn("UTC", new Date("2026-09-30T02:00:00Z"))).toBe("2026-09-30");
  });
});

describe("commissionReportParams", () => {
  it("sends only what is set", () => {
    expect(
      commissionReportParams({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "tech", techId: "t1", q: "  ", offset: 0, limit: 50 }),
    ).toEqual({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "tech", techId: "t1", limit: "50" });
  });
});

describe("columns", () => {
  const ids = (cols: { id: string }[]) => cols.map((c) => c.id);

  it("Standard shows Workiz's default columns", () => {
    expect(ids(visibleColumns("standard", {}))).toEqual([
      "dealNumber", "techName", "scheduledDate", "closedDate", "jobTypeName", "address", "total", "cash", "credit",
      "billing", "check", "rate", "tip", "parts", "companyParts", "techProfit", "companyProfit", "tax",
    ]);
  });

  it("Tech shows Created and the balance instead of Scheduled, the rate and the company profit", () => {
    const tech = ids(visibleColumns("tech", {}));
    expect(tech).toContain("createdAt");
    expect(tech).toContain("balance");
    expect(tech).not.toContain("scheduledDate");
    expect(tech).not.toContain("rate");
    expect(tech).not.toContain("companyProfit");
  });

  it("External shows the external profit, its balance and the company name", () => {
    const ext = ids(visibleColumns("external", {}));
    expect(ext).toEqual(expect.arrayContaining(["externalCompanyProfit", "externalBalance", "externalCompanyName"]));
    expect(ext).not.toContain("techProfit");
  });

  it("the viewer's Fields choice wins over the default", () => {
    const cols = ids(visibleColumns("standard", { clientName: true, tax: false }));
    expect(cols).toContain("clientName");
    expect(cols).not.toContain("tax");
    expect(commissionColumns("standard").find((c) => c.id === "clientName")?.default).toBe(false);
  });
});

describe("cells", () => {
  const row = {
    dealNumber: "TGQ6NS",
    rate: 50,
    rateUnit: "%",
    closedDate: "2026-09-02",
    closedTime: "19:00",
    scheduledDate: "2026-09-02",
    scheduledTimeSlot: "18:00-19:00",
    techProfit: 48.63,
    cashByExternal: 210,
    address: "215 Main St",
  } as unknown as CommissionReportRow;

  it("prints a rate as Workiz does", () => {
    expect(rateLabel(row)).toBe("50%");
    expect(rateLabel({ rate: 165, rateUnit: "$" })).toBe("165$");
    expect(rateLabel({})).toBe("—");
  });

  it("prints days and money", () => {
    expect(formatDayTime("2026-09-02", "19:00")).toBe("09/02/2026 07:00 PM");
    expect(formatDayTime("2026-09-02", "00:30")).toBe("09/02/2026 12:30 AM");
    expect(cellText(row, "closedDate")).toBe("09/02/2026 07:00 PM");
    expect(cellText(row, "scheduledDate")).toBe("09/02/2026 06:00 PM");
    expect(cellText(row, "techProfit")).toBe("48.63");
    expect(cellText(row, "externalBalance")).toBe("-210.00");
    expect(cellText(row, "clientName")).toBe("—");
  });
});
