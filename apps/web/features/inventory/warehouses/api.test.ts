import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countWarehouses, listWarehouses } from "./api";

function capture(path: string, body: object) {
  const seen: URLSearchParams[] = [];
  server.use(
    http.get(`*${path}`, ({ request }) => {
      seen.push(new URL(request.url).searchParams);
      return HttpResponse.json({ success: true, ...body });
    }),
  );
  return seen;
}

describe("warehouses list + count", () => {
  it("asks the server to search and filter by status", async () => {
    const seen = capture("/inventory/warehouses", { data: [], pagination: {} });
    await listWarehouses({ search: "dal", status: InventoryStatus.ARCHIVED }, "cur", 25);
    expect(Object.fromEntries(seen[0])).toEqual({
      search: "dal",
      status: "archived",
      cursor: "cur",
      limit: "25",
    });
  });

  it("counts under the same filters", async () => {
    const seen = capture("/inventory/warehouses/count", { data: { total: 2, atLeast: false } });
    await expect(countWarehouses({ search: "dal" })).resolves.toEqual({ total: 2, atLeast: false });
    expect(Object.fromEntries(seen[0])).toEqual({ search: "dal" });
  });
});
