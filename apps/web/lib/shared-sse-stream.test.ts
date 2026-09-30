import { describe, expect, it } from "vitest";
import { openSharedSseStream, type SharedStreamDeps } from "./shared-sse-stream";
import type { SseStreamOptions, StreamHandle } from "./sse-stream";

/** Web Locks as the browser grants them: one holder per name, the rest queued in order. */
function fakeLocks() {
  const queues = new Map<string, Array<{ run: () => void }>>();
  const held = new Set<string>();
  const next = (name: string) => {
    const q = queues.get(name) ?? [];
    const waiter = q.shift();
    if (waiter) waiter.run();
  };
  return {
    request(name: string, opts: { signal?: AbortSignal }, cb: () => Promise<void>): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const run = () => {
          held.add(name);
          void cb().finally(() => {
            held.delete(name);
            resolve();
            next(name);
          });
        };
        opts.signal?.addEventListener("abort", () => {
          const q = queues.get(name) ?? [];
          const i = q.findIndex((w) => w.run === run);
          if (i >= 0) {
            q.splice(i, 1);
            reject(new DOMException("aborted", "AbortError"));
          }
        });
        if (held.has(name)) queues.set(name, [...(queues.get(name) ?? []), { run }]);
        else run();
      });
    },
  };
}

/** BroadcastChannel as tabs see it: a message reaches every other instance of the name. */
function fakeChannels() {
  const all = new Set<{ name: string; onmessage: ((e: { data: unknown }) => void) | null; closed: boolean }>();
  return (name: string) => {
    const self = {
      name,
      onmessage: null as ((e: { data: unknown }) => void) | null,
      closed: false,
      postMessage(data: unknown) {
        for (const other of all) {
          if (other !== self && other.name === name && !other.closed) queueMicrotask(() => other.onmessage?.({ data }));
        }
      },
      close() {
        self.closed = true;
        all.delete(self);
      },
    };
    all.add(self);
    return self;
  };
}

/** A stand-in for the real SSE opener: records who opened and lets the test push frames. */
function fakeOpener() {
  const opened: Array<{ opts: SseStreamOptions<string>; closed: boolean }> = [];
  const open = (opts: SseStreamOptions<string>): StreamHandle => {
    const entry = { opts, closed: false };
    opened.push(entry);
    return { close: () => { entry.closed = true; } };
  };
  return { opened, open: open as SharedStreamDeps["open"] };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function tab(deps: SharedStreamDeps) {
  const events: string[] = [];
  const status: boolean[] = [];
  const handle = openSharedSseStream<string>(
    "deals",
    {
      url: "http://api/deals/stream",
      getToken: () => "t",
      parse: (d) => d,
      onEvent: (e) => events.push(e),
      onConnect: () => status.push(true),
      onDisconnect: () => status.push(false),
    },
    deps,
  );
  return { events, status, handle };
}

describe("openSharedSseStream — one connection for every tab", () => {
  it("opens the stream once however many tabs ask, and every tab hears every frame", async () => {
    const opener = fakeOpener();
    const deps = { locks: fakeLocks(), channel: fakeChannels(), open: opener.open };
    const a = tab(deps);
    const b = tab(deps);
    const c = tab(deps);
    await flush();

    expect(opener.opened).toHaveLength(1);
    opener.opened[0].opts.onConnect?.();
    opener.opened[0].opts.onEvent("deal.changed:1");
    await flush();

    for (const t of [a, b, c]) {
      expect(t.events).toEqual(["deal.changed:1"]);
      expect(t.status).toEqual([true]);
    }
  });

  it("tells a tab that arrives later that the stream is already live", async () => {
    const opener = fakeOpener();
    const deps = { locks: fakeLocks(), channel: fakeChannels(), open: opener.open };
    tab(deps);
    await flush();
    opener.opened[0].opts.onConnect?.();

    const late = tab(deps);
    await flush();
    await flush();

    expect(late.status).toEqual([true]);
  });

  it("hands the connection to the next tab when the one holding it closes", async () => {
    const opener = fakeOpener();
    const deps = { locks: fakeLocks(), channel: fakeChannels(), open: opener.open };
    const a = tab(deps);
    const b = tab(deps);
    await flush();
    opener.opened[0].opts.onConnect?.();
    await flush();

    a.handle.close();
    await flush();

    expect(opener.opened[0].closed).toBe(true);
    expect(b.status).toEqual([true, false]);
    expect(opener.opened).toHaveLength(2);
    opener.opened[1].opts.onEvent("deal.changed:2");
    expect(b.events).toEqual(["deal.changed:2"]);
  });

  it("a waiting tab that closes never opens anything", async () => {
    const opener = fakeOpener();
    const deps = { locks: fakeLocks(), channel: fakeChannels(), open: opener.open };
    const a = tab(deps);
    const b = tab(deps);
    await flush();
    b.handle.close();
    a.handle.close();
    await flush();

    expect(opener.opened).toHaveLength(1);
  });

  it("falls back to a stream of its own where tabs cannot coordinate", async () => {
    const opener = fakeOpener();
    tab({ locks: undefined, channel: undefined, open: opener.open });
    tab({ locks: undefined, channel: undefined, open: opener.open });
    expect(opener.opened).toHaveLength(2);
  });
});

