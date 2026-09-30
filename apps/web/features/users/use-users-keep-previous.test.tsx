import { describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { useUsers } from "./hooks";

/**
 * A list that pages the users (Inventory → User containers) can ask to keep
 * the page it has while a new page size loads — the table then dims instead
 * of collapsing to a skeleton. Other callers keep today's behaviour.
 */
function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function serve(gateOn: string, gate: Promise<void>) {
  server.use(
    http.get("*/users", async ({ request }) => {
      if (new URL(request.url).searchParams.get("limit") === gateOn) await gate;
      return HttpResponse.json({ success: true, data: [{ id: "u1" }], pagination: {} });
    }),
  );
}

describe("useUsers — keeping the previous page", () => {
  it("holds the page under a new size when asked", async () => {
    let release: () => void = () => {};
    serve("100", new Promise<void>((r) => (release = r)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ n }: { n: number }) => useUsers({}, n, { keepPrevious: true }), {
      wrapper: wrapper(client),
      initialProps: { n: 50 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ n: 100 });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.pages[0].data).toEqual([{ id: "u1" }]);
    release();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
  });

  it("starts empty under a new size by default, as before", async () => {
    let release: () => void = () => {};
    serve("100", new Promise<void>((r) => (release = r)));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result, rerender } = renderHook(({ n }: { n: number }) => useUsers({}, n), {
      wrapper: wrapper(client),
      initialProps: { n: 50 },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    rerender({ n: 100 });
    expect(result.current.data).toBeUndefined();
    release();
  });
});
