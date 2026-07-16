import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { globalSearch } from "./api";

describe("globalSearch", () => {
  it("builds the query string and unwraps the { success, data } envelope", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("*/search", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json({
          success: true,
          data: { query: "ac", mode: "full", groups: [], took: 1 },
        });
      }),
    );

    const res = await globalSearch({
      q: "ac",
      mode: "full",
      types: ["deal", "contact"],
      page: 2,
      size: 20,
    });

    expect(seen!.get("q")).toBe("ac");
    expect(seen!.get("mode")).toBe("full");
    expect(seen!.get("type")).toBe("deal,contact");
    expect(seen!.get("page")).toBe("2");
    expect(seen!.get("size")).toBe("20");
    // envelope unwrapped → bare SearchResponse
    expect(res.mode).toBe("full");
    expect(res.groups).toEqual([]);
  });

  it("defaults to typeahead mode", async () => {
    let mode: string | null = null;
    server.use(
      http.get("*/search", ({ request }) => {
        mode = new URL(request.url).searchParams.get("mode");
        return HttpResponse.json({
          success: true,
          data: { query: "x", mode: "typeahead", groups: [], took: 0 },
        });
      }),
    );

    await globalSearch({ q: "x" });
    expect(mode).toBe("typeahead");
  });
});
