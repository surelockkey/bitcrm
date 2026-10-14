import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useAttachments, useRefreshAttachments } from "./attachments-hooks";

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("useRefreshAttachments — a file arrived outside the Attachments tab", () => {
  it("marks the job's files stale, so the tab's list and its count are read again", () => {
    const client = newClient();
    client.setQueryData(queryKeys.deals.attachments("d1"), []);
    const { result } = renderHook(() => useRefreshAttachments("d1"), { wrapper: wrapper(client) });
    expect(client.getQueryState(queryKeys.deals.attachments("d1"))?.isInvalidated).toBe(false);

    result.current();

    expect(client.getQueryState(queryKeys.deals.attachments("d1"))?.isInvalidated).toBe(true);
  });
});

describe("useAttachments", () => {
  it("asks nothing when told not to (a job that does not exist yet)", () => {
    const client = newClient();
    const { result } = renderHook(() => useAttachments("", false), { wrapper: wrapper(client) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
