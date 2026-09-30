import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { TransferType } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countTransfers, listTransfers } from "./api";

/** The journal is filtered by type on the server — the page and its count alike. */
describe("transfers api — the type filter", () => {
  function capture() {
    const urls: URL[] = [];
    server.use(
      http.get("*/inventory/transfers", ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json({ success: true, data: [], pagination: {} });
      }),
      http.get("*/inventory/transfers/count", ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json({ success: true, data: { total: 0, atLeast: false } });
      }),
    );
    return urls;
  }

  it("asks the list for one type", async () => {
    const urls = capture();
    await listTransfers({ type: TransferType.RECEIVE }, "cur", 25);
    expect(urls[0].searchParams.get("type")).toBe("receive");
    expect(urls[0].searchParams.get("cursor")).toBe("cur");
    expect(urls[0].searchParams.get("limit")).toBe("25");
  });

  it("asks the count for the same type", async () => {
    const urls = capture();
    await countTransfers({ type: TransferType.RETURN });
    expect(urls[0].pathname).toMatch(/\/inventory\/transfers\/count$/);
    expect(urls[0].searchParams.get("type")).toBe("return");
  });

  it("sends no type for All", async () => {
    const urls = capture();
    await listTransfers({});
    await countTransfers({});
    expect(urls.map((u) => u.searchParams.has("type"))).toEqual([false, false]);
  });
});
