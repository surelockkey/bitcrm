import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import type { PaginatedResponse } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError } from "@/lib/api/errors";
import * as api from "./api";
import type { FeedMessage } from "./api";
import { applyMessage } from "./cache";
import { useResendMessage } from "./hooks";

// What the user is shown, and the one route the hook talks to — both faked.
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, me: { id: "me" }, isLoading: false, isTechnician: false }),
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  resendMessage: vi.fn(),
}));
const resendMessage = vi.mocked(api.resendMessage);

type FeedData = InfiniteData<PaginatedResponse<FeedMessage>, string | undefined>;

const failed: FeedMessage = {
  id: "m1",
  conversationId: "c1",
  channel: "sms",
  direction: "outbound",
  body: "Your tech is on the way",
  to: "+380501234567",
  status: "failed",
  errorCode: "21408",
  errorMessage: "Permission to send an SMS has not been enabled for the region",
  origin: "user",
  sentByUserId: "me",
  createdAt: "2026-09-15T09:00:00.000Z",
  updatedAt: "2026-09-15T09:00:00.000Z",
};

const created: FeedMessage = {
  ...failed,
  id: "m9",
  status: "queued",
  errorCode: undefined,
  errorMessage: undefined,
  resentFromMessageId: "m1",
  createdAt: "2026-09-15T09:05:00.000Z",
  updatedAt: "2026-09-15T09:05:00.000Z",
};

const feedKey = queryKeys.messaging.messages("c1");

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
  client.setQueryData<FeedData>(feedKey, {
    pages: [{ success: true, data: [failed], pagination: { count: 1 } }],
    pageParams: [undefined],
  });
  return client;
}

const feed = (client: QueryClient) => client.getQueryData<FeedData>(feedKey)!.pages[0].data;
const ids = (client: QueryClient) => feed(client).map((m) => m.id);
const line = (client: QueryClient, id: string) => feed(client).find((m) => m.id === id);

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const args = { conversationId: "c1", message: failed, clientMessageId: "client-1" };

beforeEach(() => {
  toast.error.mockReset();
  toast.success.mockReset();
  resendMessage.mockReset();
});

describe("useResendMessage", () => {
  it("draws the new line at once as queued, keyed by the client id, before the server answers", async () => {
    resendMessage.mockReturnValue(new Promise(() => {}));
    const client = newClient();
    const { result } = renderHook(() => useResendMessage(), { wrapper: wrapper(client) });

    result.current.mutate(args);

    await waitFor(() => expect(ids(client)).toEqual(["client-1", "m1"]));
    expect(line(client, "client-1")).toMatchObject({
      status: "queued",
      direction: "outbound",
      body: failed.body,
      to: failed.to,
      sentByUserId: "me",
      resentFromMessageId: "m1",
    });
    expect(line(client, "client-1")?.errorMessage).toBeUndefined();
    // The original keeps its failed state until the server confirms.
    expect(line(client, "m1")).toMatchObject({ status: "failed", errorCode: "21408" });
    expect(line(client, "m1")?.resentAsMessageId).toBeUndefined();
    expect(resendMessage).toHaveBeenCalledWith("c1", "m1", { clientMessageId: "client-1" });
  });

  it("swaps the placeholder for the server's message and marks the original as resent", async () => {
    resendMessage.mockResolvedValue(created);
    const client = newClient();
    const { result } = renderHook(() => useResendMessage(), { wrapper: wrapper(client) });

    result.current.mutate(args);

    await waitFor(() => expect(ids(client)).toEqual(["m9", "m1"]));
    expect(line(client, "m9")).toMatchObject({ status: "queued", resentFromMessageId: "m1" });
    expect(line(client, "m1")).toMatchObject({ status: "failed", resentAsMessageId: "m9" });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("never draws the new id twice when the stream delivers it before the 202", async () => {
    const answer = deferred<FeedMessage>();
    resendMessage.mockReturnValue(answer.promise);
    const client = newClient();
    const { result } = renderHook(() => useResendMessage(), { wrapper: wrapper(client) });

    result.current.mutate(args);
    await waitFor(() => expect(ids(client)).toContain("client-1"));

    // A `message.upserted` frame for the new line lands first (the placeholder
    // carries the wall clock, so its place among the three does not matter) …
    applyMessage(client, created);
    expect([...ids(client)].sort()).toEqual(["client-1", "m1", "m9"]);

    // … then the response: one m9, no placeholder.
    answer.resolve(created);
    await waitFor(() => expect(ids(client)).toEqual(["m9", "m1"]));

    // A later status frame patches that id in place rather than adding a line.
    applyMessage(client, { ...created, status: "delivered" });
    expect(ids(client)).toEqual(["m9", "m1"]);
    expect(line(client, "m9")?.status).toBe("delivered");
  });

  it("drops the placeholder and says why on a 409", async () => {
    resendMessage.mockRejectedValue(new ApiError(409, "Message is not in a failed state"));
    const client = newClient();
    const { result } = renderHook(() => useResendMessage(), { wrapper: wrapper(client) });

    result.current.mutate(args);

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Only failed messages can be resent"));
    expect(ids(client)).toEqual(["m1"]);
    expect(line(client, "m1")).toEqual(failed);
  });

  it("uses the opt-out wording on a 422 and the server's message otherwise", async () => {
    resendMessage.mockRejectedValueOnce(new ApiError(422, "opted out"));
    const client = newClient();
    const { result } = renderHook(() => useResendMessage(), { wrapper: wrapper(client) });

    result.current.mutate(args);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/opted out of texts/)));

    resendMessage.mockRejectedValueOnce(new ApiError(500, "Twilio is down"));
    result.current.mutate({ ...args, clientMessageId: "client-2" });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Twilio is down"));
    expect(ids(client)).toEqual(["m1"]);
  });
});
