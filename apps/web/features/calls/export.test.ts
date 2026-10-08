import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/auth-store", () => ({ getIdToken: () => "tok" }));
vi.mock("@/lib/env", () => ({ env: { apiBaseUrl: "https://api.test/api" } }));

import { downloadCallsCsv } from "./api";

/**
 * Workiz's "Export" on the call log: the same filters as the rows, streamed
 * by the server as CSV. It needs the Bearer header, which a plain link cannot
 * send — so it is fetched and handed back as a Blob for the page to save.
 */
describe("downloadCallsCsv", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("asks for export.csv with the log's filters (no paging) and the viewer's token", async () => {
    const fetchMock = vi.fn(async () => new Response("Status\n", {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="calls-2026-10-08_2026-10-09.csv"' },
    }));
    global.fetch = fetchMock as never;

    const out = await downloadCallsCsv({ status: "missed,active", q: "jane", dateFrom: "2026-10-08T04:00:00.000Z" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://api.test/api/telephony/calls/export.csv");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      status: "missed,active",
      q: "jane",
      dateFrom: "2026-10-08T04:00:00.000Z",
    });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(out.filename).toBe("calls-2026-10-08_2026-10-09.csv");
    expect(await out.blob.text()).toBe("Status\n");
  });

  it("names the file itself when the server did not", async () => {
    global.fetch = vi.fn(async () => new Response("x", { status: 200 })) as never;

    expect((await downloadCallsCsv({})).filename).toBe("calls.csv");
  });

  it("says why it failed", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: { message: "No access" } }), { status: 403 }),
    ) as never;

    await expect(downloadCallsCsv({})).rejects.toThrow("No access");
  });
});
