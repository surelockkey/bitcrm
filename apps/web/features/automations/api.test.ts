import { describe, it, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import type { AutomationSpec } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import {
  createAutomation,
  deleteAutomation,
  duplicateAutomation,
  listAutomationRunsFeed,
} from "./api";

const spec: AutomationSpec = {
  version: 1,
  trigger: { kind: "deal.status_changed", to: ["canceled"] },
  conditions: [],
  actions: [{ type: "send_sms", to: "client", body: "Hi" }],
};

const rule = {
  id: "new-1",
  name: "Canceled job",
  enabled: false,
  createdAt: "2026-09-16T10:00:00.000Z",
  updatedAt: "2026-09-16T10:00:00.000Z",
};

let seen: { url: string; body?: unknown } | undefined;

beforeEach(() => {
  seen = undefined;
  server.use(
    http.post("*/messaging/automations", async ({ request }) => {
      seen = { url: request.url, body: await request.json() };
      return HttpResponse.json({ success: true, data: rule });
    }),
    http.post("*/messaging/automations/:id/duplicate", async ({ request }) => {
      seen = { url: request.url, body: await request.json() };
      return HttpResponse.json({ success: true, data: { ...rule, name: "Copy" } });
    }),
    http.delete("*/messaging/automations/:id", ({ request, params }) => {
      seen = { url: request.url };
      return HttpResponse.json({ success: true, data: { id: String(params.id) } });
    }),
    http.get("*/messaging/automations/runs", ({ request }) => {
      seen = { url: request.url };
      return HttpResponse.json({ success: true, data: { items: [], nextCursor: "c2" } });
    }),
  );
});

describe("createAutomation", () => {
  it("posts the draft to the collection", async () => {
    await expect(createAutomation({ name: "Canceled job", spec, category: "job" })).resolves.toMatchObject({
      id: "new-1",
    });
    expect(seen?.body).toEqual({ name: "Canceled job", spec, category: "job" });
  });
});

describe("deleteAutomation", () => {
  it("deletes by id and answers with the id", async () => {
    await expect(deleteAutomation("r1")).resolves.toEqual({ id: "r1" });
    expect(seen?.url).toMatch(/\/messaging\/automations\/r1$/);
  });
});

describe("duplicateAutomation", () => {
  it("names the copy when a name is given", async () => {
    await expect(duplicateAutomation("r1", "Copy")).resolves.toMatchObject({ name: "Copy" });
    expect(seen?.body).toEqual({ name: "Copy" });
  });

  it("lets the backend name the copy when none is given", async () => {
    await duplicateAutomation("r1");
    expect(seen?.body).toEqual({});
  });
});

describe("listAutomationRunsFeed", () => {
  it("passes only the params that are set", async () => {
    await expect(listAutomationRunsFeed({ limit: 50, outcome: "failed", ruleId: "" })).resolves.toEqual({
      items: [],
      nextCursor: "c2",
    });
    const url = new URL(seen!.url);
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("outcome")).toBe("failed");
    expect(url.searchParams.has("ruleId")).toBe(false);
  });

  it("asks for the whole feed when nothing is filtered", async () => {
    await listAutomationRunsFeed();
    expect(seen?.url).toMatch(/\/messaging\/automations\/runs$/);
  });
});
