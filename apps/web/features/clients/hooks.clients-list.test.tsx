import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ContactSource, ContactType, CrmStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { useContactSearchPage, useContactsCount, useContactsPage } from "./hooks";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

const person = (id: string, firstName: string) => ({
  id,
  firstName,
  lastName: "X",
  phones: [],
  emails: [],
  addresses: [],
  type: ContactType.RESIDENTIAL,
  source: ContactSource.MANUAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

/** Workiz's Filter results → TAGS narrows the list on the server, and the count with it. */
describe("the list and its count, narrowed by client tags", () => {
  it("asks the list for the picked tags", async () => {
    let asked: URL | undefined;
    server.use(
      http.get("*/crm/contacts", ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({ success: true, data: [person("c1", "Ann")], pagination: { count: 1 } });
      }),
    );
    const { result } = renderHook(() => useContactsPage(undefined, true, 10, ["t2", "t1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.pages[0].data).toHaveLength(1));
    expect(asked?.searchParams.get("tagIds")).toBe("t1,t2");
    expect(asked?.searchParams.get("limit")).toBe("10");
  });

  it("asks nothing about tags when none are picked", async () => {
    let asked: URL | undefined;
    server.use(
      http.get("*/crm/contacts", ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({ success: true, data: [], pagination: { count: 0 } });
      }),
    );
    const { result } = renderHook(() => useContactsPage(undefined, true, 10, []), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(asked?.searchParams.has("tagIds")).toBe(false);
  });

  it("counts with the same tags", async () => {
    let asked: URL | undefined;
    server.use(
      http.get("*/crm/contacts/count", ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({ success: true, data: { total: 268, atLeast: false } });
      }),
    );
    const { result } = renderHook(() => useContactsCount(undefined, true, ["t1"]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data?.total).toBe(268));
    expect(asked?.searchParams.get("tagIds")).toBe("t1");
  });
});

/** The Search box asks the search service for one page at a time, with its total — as Workiz's server does. */
describe("useContactSearchPage", () => {
  it("asks for the page and size, and hands the contacts back in the service's order with its total", async () => {
    let asked: URL | undefined;
    server.use(
      http.get("*/search", ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({
          success: true,
          data: {
            query: "de",
            mode: "full",
            groups: [],
            hits: [
              { type: "contact", entityId: "c2" },
              { type: "contact", entityId: "c1" },
            ],
            total: 23,
            took: 3,
          },
        });
      }),
      http.post("*/crm/contacts/by-ids", () =>
        HttpResponse.json({ success: true, data: [person("c1", "Deena"), person("c2", "Dee")] }),
      ),
    );
    const { result } = renderHook(() => useContactSearchPage("de", 2, 10), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.answered).toBe(true));
    expect(result.current.rows.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(result.current.total).toBe(23);
    expect(asked?.searchParams.get("q")).toBe("de");
    expect(asked?.searchParams.get("mode")).toBe("full");
    expect(asked?.searchParams.get("type")).toBe("contact");
    expect(asked?.searchParams.get("page")).toBe("2");
    expect(asked?.searchParams.get("size")).toBe("10");
  });

  it("searches from the first character, as Workiz does", async () => {
    let asked: URL | undefined;
    server.use(
      http.get("*/search", ({ request }) => {
        asked = new URL(request.url);
        return HttpResponse.json({ success: true, data: { query: "c", mode: "full", groups: [], hits: [], total: 0, took: 1 } });
      }),
    );
    const { result } = renderHook(() => useContactSearchPage("c", 1, 10), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.answered).toBe(true));
    expect(asked?.searchParams.get("q")).toBe("c");
    expect(result.current.rows).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it("is idle for empty text", () => {
    const { result } = renderHook(() => useContactSearchPage("  ", 1, 10), { wrapper: wrapper() });
    expect(result.current.rows).toEqual([]);
    expect(result.current.answered).toBe(true);
  });
});
