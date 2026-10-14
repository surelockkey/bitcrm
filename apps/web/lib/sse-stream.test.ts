import { describe, expect, it, vi } from "vitest";
import { openSseStream } from "./sse-stream";

/**
 * A tab left open past the hour made no API calls, so nothing renewed its
 * session, and every stream retried with the expired token every 30 s for good
 * (~17,700 rejections a week). A 401 now renews the session first, and a
 * failed renewal ends the stream instead of looping.
 */
function body(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start() {} }); // stays open
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openSseStream on an expired session", () => {
  it("renews the session and reconnects with the new token", async () => {
    let token = "old";
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      seen.push(auth);
      return auth === "Bearer old"
        ? new Response(null, { status: 401 })
        : new Response(body(), { status: 200 });
    });
    const renewSession = vi.fn(async () => {
      token = "new";
      return true;
    });
    const onConnect = vi.fn();
    const handle = openSseStream({
      url: "https://api/x",
      getToken: () => token,
      parse: () => null,
      onEvent: () => undefined,
      onConnect,
      renewSession,
      fetchImpl: fetchImpl as never,
      schedule: (fn) => setTimeout(fn, 0),
    });
    await flush();
    await flush();
    await flush();
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["Bearer old", "Bearer new"]);
    expect(onConnect).toHaveBeenCalled();
    handle.close();
  });

  it("stops retrying when the session cannot be renewed", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const schedule = vi.fn((fn: () => void) => setTimeout(fn, 0));
    openSseStream({
      url: "https://api/x",
      getToken: () => "old",
      parse: () => null,
      onEvent: () => undefined,
      renewSession: async () => false,
      fetchImpl: fetchImpl as never,
      schedule,
    });
    await flush();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("keeps the ordinary backoff for anything else", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    const schedule = vi.fn(() => 0 as never);
    const renewSession = vi.fn(async () => true);
    openSseStream({
      url: "https://api/x",
      getToken: () => "t",
      parse: () => null,
      onEvent: () => undefined,
      renewSession,
      fetchImpl: fetchImpl as never,
      schedule,
    });
    await flush();
    expect(renewSession).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("does not spin when a renewed token is refused too (a deactivated account)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));
    const delays: number[] = [];
    let pending: (() => void) | null = null;
    const renewSession = vi.fn(async () => true);
    openSseStream({
      url: "https://api/x",
      getToken: () => "t",
      parse: () => null,
      onEvent: () => undefined,
      renewSession,
      fetchImpl: fetchImpl as never,
      schedule: (fn, ms) => {
        delays.push(ms);
        pending = fn;
        return 0 as never;
      },
    });
    await flush();
    (pending as unknown as () => void)();
    await flush();
    expect(renewSession).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([0, 1000]);
  });
});

