import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { ClientType, CrmStatus } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { useCompaniesByIds } from "./hooks";

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  }
  return Wrapper;
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const company = (id: string, title: string) => ({
  id,
  title,
  phones: [],
  emails: [],
  address: "",
  clientType: ClientType.COMMERCIAL,
  status: CrmStatus.ACTIVE,
  createdBy: "u1",
  createdAt: "",
  updatedAt: "",
});

/**
 * Назва компанії в рядку списку. Доти її брали з мапи всіх компаній акаунта —
 * після імпорту це 9 001 запис заради назв на одну сторінку.
 */
describe("useCompaniesByIds", () => {
  it("asks only about the companies on the page", async () => {
    let asked: unknown;
    server.use(
      http.post("*/crm/companies/by-ids", async ({ request }) => {
        asked = await request.json();
        return HttpResponse.json({ success: true, data: [company("co-1", "Acme")] });
      }),
    );

    const { result } = renderHook(() => useCompaniesByIds(["co-1"]), {
      wrapper: wrapper(client()),
    });

    await waitFor(() => expect(result.current.map.get("co-1")?.title).toBe("Acme"));
    expect(asked).toEqual({ ids: ["co-1"] });
  });

  it("asks once for an id the page repeats, and keeps the key stable", async () => {
    let calls = 0;
    server.use(
      http.post("*/crm/companies/by-ids", async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { ids: string[] };
        expect(body.ids).toEqual(["co-1", "co-2"]);
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    const c = client();

    const first = renderHook(() => useCompaniesByIds(["co-2", "co-1", "co-2"]), {
      wrapper: wrapper(c),
    });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    // Інший порядок тих самих id — той самий кеш, без другого запиту.
    renderHook(() => useCompaniesByIds(["co-1", "co-2"]), { wrapper: wrapper(c) });

    await waitFor(() => expect(calls).toBe(1));
  });

  it("asks nothing when the page names no company", async () => {
    server.use(
      http.post("*/crm/companies/by-ids", () => {
        throw new Error("не мало питати");
      }),
    );

    const { result } = renderHook(() => useCompaniesByIds([]), {
      wrapper: wrapper(client()),
    });

    expect(result.current.map.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});
