import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { InventoryStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import {
  archiveContainerTemplate,
  createContainerTemplate,
  fillFromWarehouse,
  getContainerTemplate,
  getTemplateDiff,
  listContainerTemplates,
  updateContainerTemplate,
} from "./api";

const tail = (url: string) => {
  const u = new URL(url);
  return u.pathname.replace(/^.*\/inventory/, "/inventory") + u.search;
};

function capture() {
  const seen: { method: string; url: string; body?: unknown }[] = [];
  server.use(
    http.all("*/inventory/container-templates*", async ({ request }) => {
      const body = request.method === "GET" || request.method === "DELETE" ? undefined : await request.json();
      seen.push({ method: request.method, url: tail(request.url), body });
      return HttpResponse.json({ success: true, data: { ok: true } }, { status: request.method === "POST" ? 201 : 200 });
    }),
  );
  return seen;
}

describe("container templates api", () => {
  it("lists by status", async () => {
    const seen = capture();
    await listContainerTemplates(InventoryStatus.ARCHIVED);
    await listContainerTemplates();
    expect(seen.map((s) => s.url)).toEqual([
      "/inventory/container-templates?status=archived",
      "/inventory/container-templates",
    ]);
  });

  it("reads, creates, updates and archives one", async () => {
    const seen = capture();
    await getContainerTemplate("t1");
    await createContainerTemplate({ name: "Standard van", items: [{ productId: "p1", quantity: 4 }] });
    await updateContainerTemplate("t1", { description: null, status: InventoryStatus.ACTIVE });
    await archiveContainerTemplate("t1");
    expect(seen).toEqual([
      { method: "GET", url: "/inventory/container-templates/t1", body: undefined },
      {
        method: "POST",
        url: "/inventory/container-templates",
        body: { name: "Standard van", items: [{ productId: "p1", quantity: 4 }] },
      },
      {
        method: "PUT",
        url: "/inventory/container-templates/t1",
        body: { description: null, status: "active" },
      },
      { method: "DELETE", url: "/inventory/container-templates/t1", body: undefined },
    ]);
  });

  it("compares a van with the template, with or without a warehouse", async () => {
    const seen = capture();
    await getTemplateDiff("t1", "c1", "w1");
    await getTemplateDiff("t1", "c1");
    expect(seen.map((s) => s.url)).toEqual([
      "/inventory/container-templates/t1/diff?containerId=c1&warehouseId=w1",
      "/inventory/container-templates/t1/diff?containerId=c1",
    ]);
  });

  it("fills the van from a warehouse", async () => {
    const seen = capture();
    await fillFromWarehouse("t1", { containerId: "c1", warehouseId: "w1", requestId: "r-1" });
    expect(seen).toEqual([
      {
        method: "POST",
        url: "/inventory/container-templates/t1/fill",
        // The request id makes a double click one fill, not two.
        body: { containerId: "c1", warehouseId: "w1", requestId: "r-1" },
      },
    ]);
  });
});
