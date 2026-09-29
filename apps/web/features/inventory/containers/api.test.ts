import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countContainers, listContainers } from "./api";

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

const filter = { search: "van", department: "North", status: InventoryStatus.ACTIVE };

describe("containers list + count", () => {
  it("asks the server to filter, so every page comes back full", async () => {
    const seen = capture("/inventory/containers", { data: [], pagination: {} });
    await listContainers(filter, "cur", 25);
    expect(Object.fromEntries(seen[0])).toEqual({
      search: "van",
      department: "North",
      status: "active",
      cursor: "cur",
      limit: "25",
    });
  });

  it("counts under the same filters", async () => {
    const seen = capture("/inventory/containers/count", { data: { total: 3, atLeast: false } });
    await countContainers(filter);
    expect(Object.fromEntries(seen[0])).toEqual({ search: "van", department: "North", status: "active" });
  });

  it("leaves unset filters out", async () => {
    const seen = capture("/inventory/containers", { data: [], pagination: {} });
    await listContainers({ search: "" });
    expect([...seen[0].keys()]).toEqual(["limit"]);
  });
});
