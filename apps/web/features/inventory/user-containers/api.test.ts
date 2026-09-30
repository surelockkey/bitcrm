import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { UserContainerAccess } from "@bitcrm/types";
import type { UserContainer } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import {
  assignUserContainer,
  getMyUserContainer,
  getUserContainer,
  listContainerUsers,
  listUserContainers,
} from "./api";

const row: UserContainer = {
  userId: "u1",
  userName: "Taras Koval",
  access: UserContainerAccess.CONTAINER,
  containerId: "c1",
  containerName: "Van 1",
  limited: false,
  updatedAt: "2026-09-30T10:00:00.000Z",
};

const tail = (url: string) => new URL(url).pathname.replace(/^.*\/inventory/, "/inventory");

describe("user containers api", () => {
  it("lists every assignment in one request", async () => {
    const paths: string[] = [];
    server.use(
      http.get("*/inventory/user-containers", ({ request }) => {
        paths.push(tail(request.url));
        return HttpResponse.json({ success: true, data: [row] });
      }),
    );
    expect(await listUserContainers()).toEqual([row]);
    expect(paths).toEqual(["/inventory/user-containers"]);
  });

  it("reads the caller's own row and one user's row", async () => {
    const paths: string[] = [];
    server.use(
      http.get("*/inventory/user-containers/:id", ({ request }) => {
        paths.push(tail(request.url));
        return HttpResponse.json({ success: true, data: row });
      }),
    );
    await getMyUserContainer();
    await getUserContainer("u 1");
    expect(paths).toEqual(["/inventory/user-containers/me", "/inventory/user-containers/u%201"]);
  });

  it("replaces an assignment with PUT", async () => {
    const seen: { path: string; body: unknown }[] = [];
    server.use(
      http.put("*/inventory/user-containers/:id", async ({ request }) => {
        seen.push({ path: tail(request.url), body: await request.json() });
        return HttpResponse.json({ success: true, data: row });
      }),
    );
    const body = {
      userName: "Taras Koval",
      access: UserContainerAccess.CONTAINER,
      containerId: "c1",
      limited: true,
    };
    expect(await assignUserContainer("u1", body)).toEqual(row);
    expect(seen).toEqual([{ path: "/inventory/user-containers/u1", body }]);
  });

  it("lists who works from a container", async () => {
    const paths: string[] = [];
    server.use(
      http.get("*/inventory/containers/:id/users", ({ request }) => {
        paths.push(tail(request.url));
        return HttpResponse.json({ success: true, data: [row] });
      }),
    );
    expect(await listContainerUsers("c1")).toEqual([row]);
    expect(paths).toEqual(["/inventory/containers/c1/users"]);
  });
});
