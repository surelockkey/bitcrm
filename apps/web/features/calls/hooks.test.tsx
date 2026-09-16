import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  type InfiniteData,
} from "@tanstack/react-query";
import type { PaginatedResponse } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import * as api from "./api";
import type { CallRecord } from "./lib";
import { useSetCallTags } from "./hooks";

/**
 * Tagging a call writes through the cache. The cell shows the new chip
 * optimistically and drops that draft as soon as the write settles, so what
 * the cache holds in the gap before the refetch lands is what the log paints.
 */
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  setCallTags: vi.fn(),
}));
const setCallTags = vi.mocked(api.setCallTags);

type CallPages = InfiniteData<PaginatedResponse<CallRecord>, string | undefined>;

const call = (over: Partial<CallRecord> = {}): CallRecord => ({
  callSid: "CA1",
  direction: "inbound",
  status: "completed",
  startedAt: "2026-09-16T10:00:00.000Z",
  ...over,
});

const listKey = queryKeys.calls.list({ status: "completed" });
const page = (calls: CallRecord[]): CallPages => ({
  pages: [{ success: true, data: calls, pagination: { count: calls.length } }],
  pageParams: [undefined],
});

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

function newClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<CallPages>(listKey, page([call(), call({ callSid: "CA2" })]));
  client.setQueryData<CallRecord>(queryKeys.calls.detail("CA1"), call());
  return client;
}

describe("useSetCallTags", () => {
  beforeEach(() => setCallTags.mockReset());

  it("puts the server's list into the log and the detail before refetching", async () => {
    setCallTags.mockResolvedValue(call({ tagIds: ["ct-spam"] }));
    const client = newClient();
    // Whatever else the cached row carries is none of this mutation's business.
    client.setQueryData<CallPages>(
      listKey,
      page([call({ agentName: "Dana" }), call({ callSid: "CA2" })]),
    );
    const { result } = renderHook(() => useSetCallTags(), {
      wrapper: wrapper(client),
    });

    result.current.mutate({ sid: "CA1", add: ["ct-spam"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const rows = client.getQueryData<CallPages>(listKey)!.pages[0].data;
    expect(rows[0].tagIds).toEqual(["ct-spam"]);
    expect(rows[0].agentName).toBe("Dana");
    // The other rows are left exactly as they were.
    expect(rows[1].tagIds).toBeUndefined();
    expect(
      client.getQueryData<CallRecord>(queryKeys.calls.detail("CA1"))?.tagIds,
    ).toEqual(["ct-spam"]);
  });

  it("clears the list when the last tag comes off", async () => {
    // The record comes back with no `tagIds` key at all — that is what
    // "carries no tags" looks like on the wire.
    setCallTags.mockResolvedValue(call());
    const client = newClient();
    client.setQueryData<CallPages>(listKey, page([call({ tagIds: ["ct-spam"] })]));
    const { result } = renderHook(() => useSetCallTags(), {
      wrapper: wrapper(client),
    });

    result.current.mutate({ sid: "CA1", remove: ["ct-spam"] });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // `tagIds: undefined` from the server must overwrite the stored list, not
    // be skipped as "no value" — the row carries no tags now.
    expect(client.getQueryData<CallPages>(listKey)!.pages[0].data[0].tagIds).toBeUndefined();
  });
});
