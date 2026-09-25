import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { SseStreamOptions } from "@/lib/sse-stream";
import type { CallRecord } from "./lib";
import { useCallStream } from "./use-call-stream";

const shared = vi.hoisted(() => ({
  calls: [] as Array<{ key: string; opts: SseStreamOptions<unknown>; closed: boolean }>,
}));
vi.mock("@/lib/shared-sse-stream", () => ({
  openSharedSseStream: (key: string, opts: SseStreamOptions<unknown>) => {
    const entry = { key, opts, closed: false };
    shared.calls.push(entry);
    return { close: () => { entry.closed = true; } };
  },
}));

function wrapper(client: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
  Wrapper.displayName = "QueryWrapper";
  return Wrapper;
}

describe("useCallStream", () => {
  it("rides the one stream every tab shares, and patches the live list from its frames", () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useCallStream(true), { wrapper: wrapper(client) });

    expect(shared.calls).toHaveLength(1);
    const { key, opts } = shared.calls[0];
    expect(key).toBe("calls");
    expect(opts.url).toMatch(/\/telephony\/calls\/stream$/);

    const call = { callSid: "CA1", status: "in-progress", direction: "inbound" } as CallRecord;
    const event = opts.parse(JSON.stringify({ type: "call.upserted", call }));
    expect(opts.parse("not json")).toBeNull();
    opts.onEvent(event);
    expect(client.getQueryData<CallRecord[]>(queryKeys.calls.live())).toEqual([call]);

    unmount();
    expect(shared.calls[0].closed).toBe(true);
  });

  it("opens nothing while disabled", () => {
    shared.calls.length = 0;
    renderHook(() => useCallStream(false), { wrapper: wrapper(new QueryClient()) });
    expect(shared.calls).toHaveLength(0);
  });
});
