import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/auth-store", () => ({ getIdToken: () => "id-token" }));
vi.mock("@/lib/env", () => ({ env: { apiBaseUrl: "https://api.test/api" } }));

import { downloadCommissionCsv } from "./hooks";

describe("downloadCommissionCsv", () => {
  const click = vi.fn();
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => "blob:commissions");
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(click);
  });
  afterEach(() => vi.restoreAllMocks());

  it("asks the server for every row (no page), with the id token, and saves it under the server's name", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("Job Id\r\nTotals:0", {
        status: 200,
        headers: { "Content-Disposition": 'attachment; filename="commissions_tech_Ann_closed_2026-09-21_2026-09-27.csv"' },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await downloadCommissionCsv({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "tech", techId: "ann", offset: 50, limit: 50 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/deals/reports/commissions/export?from=2026-09-21&to=2026-09-27&by=closed&mode=tech&techId=ann");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer id-token");
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("commissions_tech_Ann_closed_2026-09-21_2026-09-27.csv");
    vi.unstubAllGlobals();
  });

  it("fails loudly when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 403 })));
    await expect(downloadCommissionCsv({ from: "2026-09-21", to: "2026-09-27", by: "closed", mode: "standard" })).rejects.toThrow("403");
    vi.unstubAllGlobals();
  });
});

describe("reloadCommissionReport — Workiz's “Reload Results”", () => {
  it("re-reads the period on the server (fresh=1) and puts the answer where the page reads it", async () => {
    const { QueryClient } = await import("@tanstack/react-query");
    const { reloadCommissionReport } = await import("./hooks");
    const { commissionReportParams } = await import("./lib");
    const { queryKeys } = await import("@/lib/query-keys");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { count: 7 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient();
    const filters = { from: "2026-09-28", to: "2026-10-04", by: "closed" as const, mode: "standard" as const, limit: 50 };
    await reloadCommissionReport(client, filters);

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain("fresh=1");
    expect(client.getQueryData(queryKeys.reports.commissions(commissionReportParams(filters)))).toEqual({ count: 7 });
    vi.unstubAllGlobals();
  });
});
