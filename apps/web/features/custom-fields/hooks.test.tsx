import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import type { CustomFieldDefinition } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { queryKeys } from "@/lib/query-keys";
import { useAllCustomFields, useClientCustomFields, useCustomFields, useReorderCustomFields } from "./hooks";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function field(over: Partial<CustomFieldDefinition>): CustomFieldDefinition {
  return {
    id: "cf",
    name: "Field",
    type: "text",
    group: "",
    options: [],
    jobTypeIds: [],
    required: false,
    requiredToClose: false,
    searchable: false,
    priority: 0,
    active: true,
    createdBy: "u1",
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const catalog = [
  field({ id: "legacy" }),
  field({ id: "job", entityType: "job" }),
  field({ id: "client", entityType: "client" }),
];

function serve(rows = catalog) {
  server.use(http.get("*/deals/custom-fields", () => HttpResponse.json({ success: true, data: rows })));
}

describe("custom-field catalog hooks", () => {
  it("useCustomFields gives the job forms only job fields; the others the tab they ask for", async () => {
    serve();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const job = renderHook(() => useCustomFields(), { wrapper: wrapper(client) });
    const clientFields = renderHook(() => useClientCustomFields(), { wrapper: wrapper(client) });
    const all = renderHook(() => useAllCustomFields(), { wrapper: wrapper(client) });

    await waitFor(() => expect(all.result.current.data).toBeDefined());
    expect(job.result.current.data?.map((f) => f.id)).toEqual(["legacy", "job"]);
    expect(clientFields.result.current.data?.map((f) => f.id)).toEqual(["client"]);
    expect(all.result.current.data?.map((f) => f.id)).toEqual(["legacy", "job", "client"]);
  });

  it("useClientCustomFields asks nothing when told not to (no custom_fields.view)", () => {
    let asked = false;
    server.use(
      http.get("*/deals/custom-fields", () => {
        asked = true;
        return HttpResponse.json({ success: true, data: [] });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useClientCustomFields(false), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(asked).toBe(false);
  });
});

/**
 * A drag in Settings → Custom Fields: the moved rows' priorities are written
 * (one PUT each) and the list shows the new order at once — it does not jump
 * back while the writes are on their way.
 */
describe("useReorderCustomFields", () => {
  it("writes each moved row's priority and shows the new order straight away", async () => {
    const rows = [field({ id: "a", priority: 2 }), field({ id: "b", priority: 1 })];
    const puts: Array<{ id: string; body: unknown }> = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    server.use(
      http.get("*/deals/custom-fields", () => HttpResponse.json({ success: true, data: rows })),
      http.put("*/deals/custom-fields/:id", async ({ params, request }) => {
        puts.push({ id: String(params.id), body: await request.json() });
        await held;
        return HttpResponse.json({ success: true, data: {} });
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.customFields.list(), rows);
    const { result } = renderHook(() => useReorderCustomFields(), { wrapper: wrapper(client) });

    act(() =>
      result.current.mutate([
        { id: "b", priority: 2 },
        { id: "a", priority: 1 },
      ]),
    );

    await waitFor(() => expect(puts).toHaveLength(2));
    const shown = client.getQueryData<CustomFieldDefinition[]>(queryKeys.customFields.list());
    expect(shown?.find((f) => f.id === "b")?.priority).toBe(2);
    expect(shown?.find((f) => f.id === "a")?.priority).toBe(1);
    expect(puts).toEqual([
      { id: "b", body: { priority: 2 } },
      { id: "a", body: { priority: 1 } },
    ]);
    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
