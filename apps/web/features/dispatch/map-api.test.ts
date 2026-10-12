import { describe, it, expect, vi, afterEach } from "vitest";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { installFakeServer, type FakeRoute } from "@/test/page-load";
import { readDispatchJobs } from "./map-api";

vi.mock("@/lib/env", () => ({ env: { apiBaseUrl: "http://api.test" } }));

/**
 * The dispatch map's jobs: one `GET /deals/map` — the open jobs whole, Done /
 * Canceled for the date box's days, the techs' and clients' names beside them.
 * A deal-service from before that route answers `GET /deals/:id` instead —
 * 404 "Deal map not found" — and the board reads the old way: the jobs list
 * drained a hundred a page, then the clients by id.
 */

const deal = (id: string, over: Partial<Deal> = {}) => ({ id, contactId: `c-${id}`, assignedTechIds: [], ...over });

const NOT_FOUND = {
  match: /\/deals\/map$/,
  raw: true,
  status: 404,
  reply: () => ({ success: false, error: { code: "NOT_FOUND", message: "Deal map not found" } }),
} satisfies FakeRoute;

afterEach(() => vi.unstubAllGlobals());

describe("readDispatchJobs", () => {
  it("asks /deals/map once, with nothing but what it was given", async () => {
    const server = installFakeServer([
      {
        match: /\/deals\/map$/,
        raw: true,
        reply: () => ({
          success: true,
          data: [deal("d1", { assignedTechIds: ["t1"] })],
          pagination: { count: 1 },
          included: {
            technicians: [{ id: "t1", firstName: "Ana", lastName: "Tech" }],
            clients: [{ id: "c-d1", firstName: "Bo", lastName: "Client", phones: ["+14045550100"], emails: [] }],
          },
        }),
      },
    ]);

    const jobs = await readDispatchJobs({});

    expect(server.requests).toEqual(["/deals/map"]);
    expect(jobs.deals.map((d) => d.id)).toEqual(["d1"]);
    expect(jobs.technicians).toEqual([{ id: "t1", firstName: "Ana", lastName: "Tech" }]);
    expect(jobs.clients).toEqual([
      { id: "c-d1", firstName: "Bo", lastName: "Client", phones: ["+14045550100"], emails: [] },
    ]);
  });

  it("sends the closed statuses and their days", async () => {
    const server = installFakeServer([
      { match: /\/deals\/map$/, raw: true, reply: () => ({ success: true, data: [], pagination: { count: 0 }, included: { technicians: [], clients: [] } }) },
    ]);

    await readDispatchJobs({ statuses: [JobSuperStatus.DONE, JobSuperStatus.CANCELED], from: "2026-10-11", to: "2026-10-17" });

    const url = new URL(server.requests[0], "http://api.test");
    expect(url.pathname).toBe("/deals/map");
    expect(url.searchParams.get("statuses")).toBe("done,canceled");
    expect(url.searchParams.get("from")).toBe("2026-10-11");
    expect(url.searchParams.get("to")).toBe("2026-10-17");
  });

  it("on a deal-service without /deals/map (404) reads the old way: the list drained, then the clients by id", async () => {
    const server = installFakeServer([
      NOT_FOUND,
      {
        match: /\/deals$/,
        raw: true,
        reply: (url) => {
          const status = url.searchParams.get("superStatus");
          const cursor = url.searchParams.get("cursor");
          const page = (data: unknown[], nextCursor?: string) => ({ success: true, data, pagination: { nextCursor } });
          if (status === "submitted") return cursor ? page([deal("d2")]) : page([deal("d1")], "next");
          if (status === "pending") return page([deal("d1"), deal("d3")]);
          return page([]);
        },
      },
      {
        match: /\/crm\/contacts\/by-ids$/,
        method: "POST",
        reply: () => [
          { id: "c-d1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550101"], emails: ["ivy@x.test"], addresses: [], notes: "x" },
          { id: "c-d2", firstName: "Otto", lastName: "Brisk", phones: [], phonesMasked: true, emails: [], addresses: [] },
        ],
      },
    ]);

    const jobs = await readDispatchJobs({});

    expect(jobs.deals.map((d) => d.id)).toEqual(["d1", "d2", "d3"]);
    expect(jobs.clients).toEqual([
      { id: "c-d1", firstName: "Ivy", lastName: "Quill", phones: ["+14045550101"], emails: ["ivy@x.test"] },
      { id: "c-d2", firstName: "Otto", lastName: "Brisk", phones: [], emails: [], phonesMasked: true },
    ]);
    // The old API names no technicians beside the jobs: the board waits for its directory.
    expect(jobs.technicians).toBeNull();
    const statuses = server.requests
      .filter((r) => r.startsWith("/deals?"))
      .map((r) => new URL(r, "http://api.test").searchParams.get("superStatus"));
    expect(new Set(statuses)).toEqual(new Set(["submitted", "in_progress", "pending", "done_pending_approval"]));
    expect(server.requests.filter((r) => r === "/crm/contacts/by-ids")).toHaveLength(1);
  });

  it("falls back to the date window for Done / Canceled", async () => {
    const server = installFakeServer([
      NOT_FOUND,
      { match: /\/deals$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
    ]);

    await readDispatchJobs({ statuses: [JobSuperStatus.DONE], from: "2026-10-11", to: "2026-10-17" });

    const list = server.requests.filter((r) => r.startsWith("/deals?")).map((r) => new URL(r, "http://api.test").searchParams);
    expect(list).toHaveLength(1);
    expect(list[0].get("superStatus")).toBe("done");
    expect(list[0].get("scheduledFrom")).toBe("2026-10-11");
    expect(list[0].get("scheduledTo")).toBe("2026-10-17");
  });

  it("a fallback whose clients fail still has its jobs", async () => {
    const server = installFakeServer([
      NOT_FOUND,
      { match: /\/deals$/, raw: true, reply: () => ({ success: true, data: [deal("d1")], pagination: {} }) },
    ]);
    server.fail(/\/crm\/contacts\/by-ids$/);

    const jobs = await readDispatchJobs({ statuses: [JobSuperStatus.SUBMITTED] });

    expect(jobs.deals.map((d) => d.id)).toEqual(["d1"]);
    expect(jobs.clients).toEqual([]);
  });

  it("any other failure is a failure — no second guess", async () => {
    const server = installFakeServer([{ match: /\/deals\/map$/, reply: () => null }]);
    server.fail(/\/deals\/map$/);

    await expect(readDispatchJobs({})).rejects.toMatchObject({ status: 500 });
    expect(server.requests).toEqual(["/deals/map"]);
  });
});
