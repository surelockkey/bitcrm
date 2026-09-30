import { describe, it, expect, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus, UserContainerAccess } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { countContainers, fetchMyContainer, listContainers } from "./api";

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

/**
 * The technician's own van comes from their user-container row first; the
 * old /containers/my stays the fallback for someone without a row.
 */
describe("fetchMyContainer", () => {
  const van = (id: string) => ({ id, name: `Van ${id}`, status: InventoryStatus.ACTIVE, createdAt: "", updatedAt: "" });
  const mine = (over: object) => ({
    userId: "me",
    userName: "Me",
    access: UserContainerAccess.CONTAINER,
    containerId: "c2",
    limited: false,
    updatedAt: "",
    ...over,
  });

  function serve(me: () => Response) {
    const paths: string[] = [];
    server.events.on("request:start", ({ request }) => {
      paths.push(new URL(request.url).pathname.replace(/^.*\/inventory/, "/inventory"));
    });
    server.use(
      http.get("*/inventory/user-containers/me", me),
      http.get("*/inventory/containers/my", () => HttpResponse.json({ success: true, data: van("legacy") })),
      http.get("*/inventory/containers/:id", ({ params }) =>
        HttpResponse.json({ success: true, data: van(String(params.id)) }),
      ),
    );
    return paths;
  }

  afterEach(() => server.events.removeAllListeners());

  it("opens the van the user's row names", async () => {
    const paths = serve(() => HttpResponse.json({ success: true, data: mine({}) }));
    expect((await fetchMyContainer())?.id).toBe("c2");
    expect(paths).toEqual(["/inventory/user-containers/me", "/inventory/containers/c2"]);
  });

  it("falls back to /containers/my for someone without a row", async () => {
    const paths = serve(() => HttpResponse.json({ success: false, message: "Not found" }, { status: 404 }));
    expect((await fetchMyContainer())?.id).toBe("legacy");
    expect(paths).toEqual(["/inventory/user-containers/me", "/inventory/containers/my"]);
  });

  it("has no van for All locations or No access — and asks nothing more", async () => {
    for (const access of [UserContainerAccess.ALL, UserContainerAccess.NONE]) {
      const paths = serve(() =>
        HttpResponse.json({ success: true, data: mine({ access, containerId: undefined }) }),
      );
      expect(await fetchMyContainer()).toBeNull();
      expect(paths).toEqual(["/inventory/user-containers/me"]);
      server.events.removeAllListeners();
    }
  });

  // A technician may not be allowed GET /containers/:id; /containers/my
  // resolves the same row on the server.
  it("reads the van through /containers/my when it can't open it by id", async () => {
    serve(() => HttpResponse.json({ success: true, data: mine({}) }));
    server.use(
      http.get("*/inventory/containers/c2", () =>
        HttpResponse.json({ success: false, message: "Forbidden" }, { status: 403 }),
      ),
    );
    expect((await fetchMyContainer())?.id).toBe("legacy");
  });

  it("fails on any other error reading the row", async () => {
    serve(() => HttpResponse.json({ success: false, message: "boom" }, { status: 500 }));
    await expect(fetchMyContainer()).rejects.toThrow("boom");
  });
});
