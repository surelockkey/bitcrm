import { describe, it, expect, vi } from "vitest";
import { openMessagingStream, parseRealtimeFrame } from "./stream";
import type { MessagingRealtimeEvent } from "./api";

describe("parseRealtimeFrame", () => {
  it("returns a typed event for known frame types", () => {
    const event = parseRealtimeFrame(
      '{"type":"counters.changed","at":"t","counters":{"unreadConversations":1,"flaggedConversations":0,"unreadByKind":{}}}',
    );
    expect(event?.type).toBe("counters.changed");
  });

  it("drops malformed JSON and unknown types", () => {
    expect(parseRealtimeFrame("not json")).toBeNull();
    expect(parseRealtimeFrame('{"type":"call.upserted"}')).toBeNull();
    expect(parseRealtimeFrame("null")).toBeNull();
  });
});

/** A fetch whose body is a stream we push text into by hand. */
function fakeStream(status = 200) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  const response = { ok: status >= 200 && status < 300, status, body } as unknown as Response;
  return {
    response,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("openMessagingStream", () => {
  it("sends the bearer token, reports connect, and emits parsed frames", async () => {
    const stream = fakeStream();
    const fetchImpl = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => stream.response,
    );
    const events: MessagingRealtimeEvent[] = [];
    const onConnect = vi.fn();

    const handle = openMessagingStream({
      url: "http://api/messaging/events",
      getToken: () => "tok",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (e) => events.push(e),
      onConnect,
      schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
    });
    await flush();

    const init = fetchImpl.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(onConnect).toHaveBeenCalledTimes(1);

    stream.push(': connected\n\n: hb\n\ndata: {"type":"counters.changed","at":"t","counters":{"unreadConversations":2,"flaggedConversations":0,"unreadByKind":{}}}\n\n');
    await flush();
    expect(events.map((e) => e.type)).toEqual(["counters.changed"]);

    handle.close();
  });

  it("reconnects with growing backoff after the stream ends, and stops once closed", async () => {
    const first = fakeStream();
    const second = fakeStream();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);
    const delays: number[] = [];
    const pending: Array<() => void> = [];
    const schedule = (fn: () => void, ms: number) => {
      delays.push(ms);
      pending.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
    const onDisconnect = vi.fn();

    const handle = openMessagingStream({
      url: "u",
      getToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: () => {},
      onDisconnect,
      schedule,
      reconnectMinMs: 100,
      reconnectMaxMs: 250,
    });
    await flush();

    first.end(); // server closed the stream
    await flush();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([100]);

    pending.shift()!(); // the reconnect fires
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    second.end();
    await flush();
    // Backoff doubled from the reset value on a successful connect.
    expect(delays).toEqual([100, 100]);

    handle.close();
    pending.shift()!();
    await flush();
    expect(fetchImpl).toHaveBeenCalledTimes(2); // closed: no third attempt
  });

  it("does not report a disconnect for a connection that never opened", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, body: null }) as unknown as Response);
    const onConnect = vi.fn();
    const onDisconnect = vi.fn();
    const handle = openMessagingStream({
      url: "u",
      getToken: () => "t",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: () => {},
      onConnect,
      onDisconnect,
      schedule: () => 0 as unknown as ReturnType<typeof setTimeout>,
    });
    await flush();
    expect(onConnect).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
    handle.close();
  });
});
