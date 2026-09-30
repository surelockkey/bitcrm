import { describe, expect, it, vi } from "vitest";
import { InventoryLogAction, ReturnReason } from "@bitcrm/types";
import { drainPages, logCsvRows, returnsCsvRows, toCsv, usageCsvRows } from "./export";
import type { InventoryUsageRow, ReportLogEntry } from "./types";

describe("drainPages", () => {
  it("follows the cursor to the end and reports the rows as they arrive", async () => {
    const pages: Record<string, { data: number[]; pagination: { nextCursor?: string } }> = {
      start: { data: [1, 2], pagination: { nextCursor: "b" } },
      b: { data: [3, 4], pagination: { nextCursor: "c" } },
      c: { data: [5], pagination: {} },
    };
    const fetchPage = vi.fn(async (cursor?: string) => pages[cursor ?? "start"]);
    const progress: number[] = [];

    const out = await drainPages(fetchPage, { cap: 100, onProgress: (n) => progress.push(n) });

    expect(out).toEqual({ rows: [1, 2, 3, 4, 5], capped: false });
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([undefined, "b", "c"]);
    expect(progress).toEqual([2, 4, 5]);
  });

  it("stops at the cap and says so", async () => {
    const fetchPage = vi.fn(async (cursor?: string) => ({
      data: [1, 2, 3],
      pagination: { nextCursor: `${Number(cursor ?? 0) + 1}` },
    }));
    const out = await drainPages(fetchPage, { cap: 7 });
    expect(out.rows).toHaveLength(7);
    expect(out.capped).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("the last page landing exactly on the cap is not 'capped'", async () => {
    const fetchPage = vi.fn(async () => ({ data: [1, 2], pagination: {} }));
    expect(await drainPages(fetchPage, { cap: 2 })).toEqual({ rows: [1, 2], capped: false });
  });

  it("an empty page with a cursor does not loop forever", async () => {
    const fetchPage = vi.fn(async () => ({ data: [] as number[], pagination: { nextCursor: "same" } }));
    const out = await drainPages(fetchPage, { cap: 10, maxPages: 5 });
    expect(out.rows).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(5);
  });
});

const usage: InventoryUsageRow[] = [
  {
    dealId: "d1",
    dealNumber: 11153,
    jobDate: "2026-09-29",
    clientName: "John Smith",
    techNames: ["Ann Lee", "Bo Chen"],
    productId: "p1",
    productName: "Nest Thermostat",
    sku: "T3018US",
    qty: 2,
    unitPrice: 466.79,
    unitCost: 250,
    total: 933.58,
    source: "workiz",
  },
];

describe("usageCsvRows", () => {
  it("Workiz's columns, plus a Totals line from the summary", () => {
    const rows = usageCsvRows(usage, { money: true, summary: { rows: 1, qty: 2, total: 933.58, cost: 500 } });
    expect(rows[0]).toEqual({
      Item: "Nest Thermostat",
      SKU: "T3018US",
      Job: "11153",
      Client: "John Smith",
      "Job date": "Tue Sep 29, 2026",
      Techs: "Ann Lee, Bo Chen",
      Qty: "2.00",
      Price: "466.79",
      Cost: "250.00",
      Total: "933.58",
    });
    expect(rows.at(-1)).toEqual({
      Item: "Totals",
      SKU: "",
      Job: "",
      Client: "",
      "Job date": "",
      Techs: "",
      Qty: "2.00",
      Price: "",
      Cost: "500.00",
      Total: "933.58",
    });
  });

  it("no money columns without financials.view", () => {
    const rows = usageCsvRows(usage, { money: false, summary: { rows: 1, qty: 2 } });
    expect(Object.keys(rows[0])).toEqual(["Item", "SKU", "Job", "Client", "Job date", "Techs", "Qty"]);
    expect(rows.at(-1)).toMatchObject({ Item: "Totals", Qty: "2.00" });
  });

  it("names techs through the lookup when the row carries only ids", () => {
    const rows = usageCsvRows([{ ...usage[0], techNames: undefined, techIds: ["t1", "t2"] }], {
      money: false,
      techName: (id) => (id === "t1" ? "Ann Lee" : undefined),
    });
    expect(rows[0].Techs).toBe("Ann Lee");
  });
});

const returned: ReportLogEntry = {
  id: "r1",
  action: InventoryLogAction.STOCK_RETURNED,
  productId: "p1",
  productName: "Ecobee Remote",
  sku: "EB-1",
  quantity: 10,
  reason: ReturnReason.DAMAGED,
  fromName: "Main",
  userId: "u1",
  userName: "Kristian Ibarra",
  createdAt: new Date(2023, 8, 4, 8, 11).toISOString(),
};

describe("returnsCsvRows", () => {
  it("one line per return, then the Totals line", () => {
    const rows = returnsCsvRows([returned], { rows: 1, qty: 10 });
    expect(rows[0]).toEqual({
      Item: "Ecobee Remote",
      SKU: "EB-1",
      "Return date": "Mon Sep 4 2023 8:11 am",
      Qty: "10.00",
      Reason: "Damaged",
      Location: "Main",
      User: "Kristian Ibarra",
    });
    expect(rows.at(-1)).toMatchObject({ Item: "Totals", Qty: "10.00" });
  });
});

describe("logCsvRows", () => {
  it("the description as on screen, and the job's number", () => {
    const used: ReportLogEntry = {
      ...returned,
      id: "l1",
      action: InventoryLogAction.STOCK_USED,
      quantity: 1,
      dealId: "d1",
      reason: undefined,
    };
    const rows = logCsvRows([used], new Map([["d1", 1749]]));
    expect(rows[0]).toEqual({
      Item: "Ecobee Remote",
      SKU: "EB-1",
      User: "Kristian Ibarra",
      Time: "Mon Sep 4 2023 8:11 am",
      Description: "Used 1 in job #1749",
      Job: "1749",
    });
  });

  it("an entry without an item or a job leaves those cells empty", () => {
    const assigned: ReportLogEntry = {
      id: "l2",
      action: InventoryLogAction.CONTAINER_ASSIGNED,
      subjectUserName: "John Smith",
      userId: "u1",
      userName: "Admin",
      createdAt: returned.createdAt,
    };
    const [row] = logCsvRows([assigned], new Map());
    expect(row.Item).toBe("");
    expect(row.Job).toBe("");
  });
});

describe("toCsv", () => {
  it("quotes what needs quoting", () => {
    expect(toCsv([{ A: 'say "hi"', B: "1,2" }])).toBe('A,B\n"say ""hi""","1,2"');
  });

  it("defuses cells a spreadsheet would run as a formula", () => {
    expect(toCsv([{ A: "=HYPERLINK(1)", B: "-5" }])).toBe("A,B\n'=HYPERLINK(1),-5");
  });
});
