import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetchPaginated } from "@/lib/api/http";
import { getTimeline } from "./api";

vi.mock("@/lib/api/http", () => ({
  http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  apiFetchPaginated: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe("getTimeline — the job's Timeline", () => {
  /**
   * The right rail counts the job's notes, and the panel's filter says
   * "Activities (58)". Both read the first page, so it is the server's
   * largest (100): whole for all but the longest jobs, instead of "3+".
   */
  it("asks for the server's largest page", async () => {
    vi.mocked(apiFetchPaginated).mockResolvedValue({ success: true, data: [], pagination: { count: 0 } });
    await getTimeline("d1");
    await getTimeline("d1", "next");
    expect(vi.mocked(apiFetchPaginated).mock.calls.map(([p]) => p)).toEqual([
      "/deals/d1/timeline?limit=100",
      "/deals/d1/timeline?limit=100&cursor=next",
    ]);
  });
});
