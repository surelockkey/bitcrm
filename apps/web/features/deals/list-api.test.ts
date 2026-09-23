import { afterEach, describe, expect, it, vi } from "vitest";
import { JobSuperStatus } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import { getDealCounts, getDealsByIds, listDeals } from "./api";

vi.mock("@/lib/api/http", () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  apiFetchPaginated: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe("listDeals — one page of the jobs list", () => {
  it("sends every parameter it was given and nothing it was not", async () => {
    vi.mocked(apiFetchPaginated).mockResolvedValue({ success: true, data: [], pagination: { count: 0 } });
    await listDeals({
      superStatus: JobSuperStatus.SUBMITTED,
      scheduledFrom: "2026-09-21",
      scheduledTo: "2026-09-27",
      hourFrom: "08:00",
      techId: "t1",
      tagIds: "tag",
      sort: "schedule",
      dir: "desc",
      limit: 50,
      cursor: "abc",
    });
    const [path] = vi.mocked(apiFetchPaginated).mock.calls[0];
    const q = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith("/deals?")).toBe(true);
    expect(Object.fromEntries(q)).toEqual({
      superStatus: "submitted",
      scheduledFrom: "2026-09-21",
      scheduledTo: "2026-09-27",
      hourFrom: "08:00",
      techId: "t1",
      tagIds: "tag",
      sort: "schedule",
      dir: "desc",
      limit: "50",
      cursor: "abc",
    });
  });

  it("the undated tab is unscheduled=true", async () => {
    vi.mocked(apiFetchPaginated).mockResolvedValue({ success: true, data: [], pagination: { count: 0 } });
    await listDeals({ unscheduled: true, limit: 50 });
    const [path] = vi.mocked(apiFetchPaginated).mock.calls[0];
    expect(new URLSearchParams(path.split("?")[1]).get("unscheduled")).toBe("true");
  });
});

describe("getDealCounts", () => {
  it("asks /deals/counts with the same filters", async () => {
    vi.mocked(http.get).mockResolvedValue({ submitted: 1 });
    await getDealCounts({ techId: "t1", scheduledFrom: "2026-09-23", scheduledTo: "2026-09-23" });
    const [path] = vi.mocked(http.get).mock.calls[0];
    expect(path.startsWith("/deals/counts?")).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(path.split("?")[1]))).toEqual({
      techId: "t1",
      scheduledFrom: "2026-09-23",
      scheduledTo: "2026-09-23",
    });
  });
});

describe("getDealsByIds", () => {
  it("posts the ids and answers nothing for an empty list without a request", async () => {
    vi.mocked(http.post).mockResolvedValue([{ id: "a" }]);
    expect(await getDealsByIds([])).toEqual([]);
    expect(http.post).not.toHaveBeenCalled();
    await getDealsByIds(["a", "b"]);
    expect(http.post).toHaveBeenCalledWith("/deals/by-ids", { ids: ["a", "b"] });
  });
});
