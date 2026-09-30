import { openSseStream, type SseStreamOptions, type StreamHandle } from "./sse-stream";

/** The browser pieces tabs coordinate through — injectable for tests. */
export interface SharedStreamDeps {
  locks?: Pick<LockManager, "request"> | { request: (name: string, opts: { signal?: AbortSignal }, cb: () => Promise<void>) => Promise<void> };
  channel?: (name: string) => Pick<BroadcastChannel, "postMessage" | "close"> & {
    onmessage: ((e: { data: unknown }) => void) | null;
  };
  open?: <T>(opts: SseStreamOptions<T>) => StreamHandle;
}

type Message<T> =
  | { kind: "event"; event: T }
  | { kind: "status"; connected: boolean }
  | { kind: "hello" };

function browserDeps(): SharedStreamDeps {
  const hasLocks = typeof navigator !== "undefined" && !!navigator.locks;
  const hasChannel = typeof BroadcastChannel !== "undefined";
  return {
    locks: hasLocks ? navigator.locks : undefined,
    channel: hasChannel ? (name) => new BroadcastChannel(name) as never : undefined,
    open: openSseStream,
  };
}

/**
 * One SSE connection per browser, not per tab. Browsers allow six HTTP/1.1
 * connections to a host, and every open stream holds one for good — two
 * streams a tab, three tabs, and nothing else loads (the dev server proxies
 * the API over HTTP/1.1). So the tab holding the Web Lock named after the
 * stream opens it and relays each frame and its connected / dropped state to
 * the others over a BroadcastChannel; when it closes, the lock passes to the
 * next tab, which opens the stream in turn. Every tab — the holder included —
 * sees the same `onEvent` / `onConnect` / `onDisconnect` calls it would with a
 * stream of its own. Without Web Locks or BroadcastChannel each tab simply
 * opens its own.
 */
export function openSharedSseStream<T>(
  key: string,
  opts: SseStreamOptions<T>,
  deps: SharedStreamDeps = browserDeps(),
): StreamHandle {
  const open = deps.open ?? openSseStream;
  if (!deps.locks || !deps.channel) return open(opts);

  const channel = deps.channel(`sse:${key}`);
  const abort = new AbortController();
  let leading = false;
  let connected = false;
  let release: (() => void) | null = null;
  let closed = false;

  const post = (m: Message<T>) => channel.postMessage(m);
  const setStatus = (next: boolean) => {
    if (connected === next) return;
    connected = next;
    if (next) opts.onConnect?.();
    else opts.onDisconnect?.();
  };

  channel.onmessage = ({ data }) => {
    const m = data as Message<T>;
    if (m.kind === "hello") {
      if (leading && connected) post({ kind: "status", connected: true });
      return;
    }
    if (leading) return;
    if (m.kind === "event") opts.onEvent(m.event);
    else if (m.kind === "status") setStatus(m.connected);
  };
  // Ask whoever holds the stream whether it is live.
  post({ kind: "hello" });

  deps.locks
    .request(`sse:${key}`, { signal: abort.signal }, async () => {
      if (closed) return;
      leading = true;
      const stream = open({
        ...opts,
        onEvent: (event) => {
          opts.onEvent(event);
          post({ kind: "event", event });
        },
        onConnect: () => {
          setStatus(true);
          post({ kind: "status", connected: true });
        },
        onDisconnect: () => {
          setStatus(false);
          post({ kind: "status", connected: false });
        },
      });
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      stream.close();
      post({ kind: "status", connected: false });
      leading = false;
    })
    // A tab that closes while still waiting for the lock is aborted — not an error.
    .catch(() => undefined);

  return {
    close() {
      closed = true;
      abort.abort();
      release?.();
      // Let the goodbye status leave before the channel shuts.
      queueMicrotask(() => channel.close());
    },
  };
}
