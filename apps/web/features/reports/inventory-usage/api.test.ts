import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { fetchReportSummary, listReportPage } from "./api";
import { EMPTY_FILTERS } from "./params";
import type { ReportQuery } from "./types";

/** Records every call to `path` (exactly — not its sub-paths) and answers `body`. */
function capture(path: string, body: unknown) {
  const seen: URL[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json({ success: true, ...(body as object) });
    }),
  );
  return seen;
}

const plain: ReportQuery = { from: "2026-09-01", to: "2026-09-30", filters: EMPTY_FILTERS };

const everything: ReportQuery = {
  from: "2026-09-01",
  to: "2026-09-30",
  search: "nest",
  filters: {
    techIds: ["u1", "u2"],
    locationIds: ["w1"],
    categories: ["Locks", "Keys"],
    brandIds: ["b1"],
  },
};

describe("listReportPage", () => {
  it("Usage: the window on the job date, every pick as its own param, the page", async () => {
    const seen = capture("/inventory/reports/inventory-usage", { data: [], pagination: { count: 0 } });
    await listReportPage("usage", everything, "cur-1", 10);

    const q = seen[0].searchParams;
    expect(q.get("from")).toBe("2026-09-01");
    expect(q.get("to")).toBe("2026-09-30");
    expect(q.getAll("techId")).toEqual(["u1", "u2"]);
    expect(q.getAll("locationId")).toEqual(["w1"]);
    expect(q.getAll("category")).toEqual(["Locks", "Keys"]);
    expect(q.getAll("brandId")).toEqual(["b1"]);
    expect(q.get("search")).toBe("nest");
    expect(q.get("limit")).toBe("10");
    expect(q.get("cursor")).toBe("cur-1");
  });

  it("leaves out what isn't set", async () => {
    const seen = capture("/inventory/reports/inventory-usage", { data: [], pagination: { count: 0 } });
    await listReportPage("usage", { ...plain, search: "  " }, undefined, 25);
    expect([...seen[0].searchParams.keys()]).toEqual(["from", "to", "limit"]);
  });

  it("Returns: its own endpoint; the Tech picks are who did the return", async () => {
    const seen = capture("/inventory/reports/inventory-returns", { data: [], pagination: { count: 0 } });
    await listReportPage("returns", everything, undefined, 10);
    expect(seen[0].pathname).toMatch(/\/inventory\/reports\/inventory-returns$/);
    const q = seen[0].searchParams;
    expect(q.getAll("userId")).toEqual(["u1", "u2"]);
    expect(q.has("techId")).toBe(false);
    expect(q.getAll("locationId")).toEqual(["w1"]);
  });

  it("Action log: the inventory log itself; the Tech picks are who acted", async () => {
    const seen = capture("/inventory/inventory-log", { data: [], pagination: { count: 0 } });
    await listReportPage("log", everything, undefined, 50);
    expect(seen[0].pathname).toMatch(/\/inventory\/inventory-log$/);
    expect(seen[0].searchParams.getAll("userId")).toEqual(["u1", "u2"]);
    expect(seen[0].searchParams.get("limit")).toBe("50");
  });

  it("hands back the rows and the next cursor", async () => {
    capture("/inventory/reports/inventory-usage", {
      data: [{ dealId: "d1", productId: "p1", qty: 2 }],
      pagination: { nextCursor: "next", count: 1 },
    });
    const page = await listReportPage("usage", plain, undefined, 10);
    expect(page.data).toHaveLength(1);
    expect(page.pagination.nextCursor).toBe("next");
  });

  it("a page without a pagination block is the last one", async () => {
    capture("/inventory/reports/inventory-usage", { data: [] });
    const page = await listReportPage("usage", plain, undefined, 10);
    expect(page.pagination.nextCursor).toBeUndefined();
  });
});

describe("fetchReportSummary", () => {
  it("Usage: the totals under the same filters, without paging", async () => {
    const seen = capture("/inventory/reports/inventory-usage/summary", {
      data: { rows: 368, qty: 553, total: 110926.3, cost: 37701.73, atLeast: false },
    });
    const s = await fetchReportSummary("usage", everything);
    expect(s).toEqual({ rows: 368, qty: 553, total: 110926.3, cost: 37701.73, atLeast: false });
    const q = seen[0].searchParams;
    expect(q.getAll("techId")).toEqual(["u1", "u2"]);
    expect(q.get("search")).toBe("nest");
    expect(q.has("limit")).toBe(false);
    expect(q.has("cursor")).toBe(false);
  });

  it("Returns: rows and Σ qty", async () => {
    capture("/inventory/reports/inventory-returns/summary", { data: { rows: 16, qty: 33 } });
    expect(await fetchReportSummary("returns", plain)).toEqual({ rows: 16, qty: 33 });
  });

  it("Action log: only a count — no totals", async () => {
    const seen = capture("/inventory/inventory-log/count", { data: { total: 1789, atLeast: true } });
    expect(await fetchReportSummary("log", everything)).toEqual({ rows: 1789, atLeast: true });
    expect(seen[0].searchParams.getAll("userId")).toEqual(["u1", "u2"]);
  });

  it("a count the server can't give is no count, not zero", async () => {
    capture("/inventory/inventory-log/count", { data: { total: null, atLeast: false } });
    expect((await fetchReportSummary("log", plain)).rows).toBeUndefined();
  });
});
