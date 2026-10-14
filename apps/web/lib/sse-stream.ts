import { createSseParser } from "@/features/calls/sse";
import { renewSessionOrSignOut } from "@/lib/api/http";

export interface SseStreamOptions<T> {
  url: string;
  getToken: () => string | null | undefined;
  /** A `data:` frame → the event, or null to drop it. */
  parse: (data: string) => T | null;
  onEvent: (event: T) => void;
  /** The response headers arrived — the stream is live. */
  onConnect?: () => void;
  /** The stream ended or failed; a reconnect is scheduled unless closed. */
  onDisconnect?: () => void;
  /**
   * Called on a 401: renew the session and resolve true to reconnect at once
   * with the new token, false to end the stream. Defaults to the API client's
   * renewal, which signs the user out when it fails.
   */
  renewSession?: () => Promise<boolean>;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** Injectable for tests (defaults to setTimeout). */
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

export interface StreamHandle {
  close: () => void;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Opens an SSE stream with fetch (EventSource cannot send the
 * Bearer header), parses frames incrementally and reconnects with
 * exponential backoff. A 401 renews the session first (a tab left open
 * makes no API calls, so nothing else would) and reconnects with the new
 * token; a renewal that fails ends the stream rather than retrying an expired
 * token forever.
 */
export function openSseStream<T>(opts: SseStreamOptions<T>): StreamHandle {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const schedule = opts.schedule ?? setTimeout;
  const minMs = opts.reconnectMinMs ?? RECONNECT_MIN_MS;
  const maxMs = opts.reconnectMaxMs ?? RECONNECT_MAX_MS;
  const renewSession = opts.renewSession ?? renewSessionOrSignOut;

  const controller = new AbortController();
  let backoff = minMs;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  /** A renewal already happened since the last good connect: a second 401 backs off instead. */
  let renewed = false;

  const connect = async () => {
    if (closed) return;
    let connected = false;
    try {
      const res = await fetchImpl(opts.url, {
        headers: { Authorization: `Bearer ${opts.getToken() ?? ""}` },
        signal: controller.signal,
      });
      if (res.status === 401 && !renewed) {
        renewed = true;
        if (!(await renewSession())) {
          closed = true;
          return;
        }
        if (closed) return;
        backoff = minMs;
        timer = schedule(() => {
          timer = null;
          void connect();
        }, 0);
        return;
      }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

      connected = true;
      renewed = false;
      backoff = minMs;
      opts.onConnect?.();

      const parser = createSseParser((data) => {
        const event = opts.parse(data);
        if (event) opts.onEvent(event);
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
      }
      throw new Error("stream closed");
    } catch {
      if (closed) return;
      if (connected) opts.onDisconnect?.();
      timer = schedule(() => {
        timer = null;
        if (closed) return;
        backoff = Math.min(backoff * 2, maxMs);
        // At the longest backoff, a 401 may try one renewal again.
        if (backoff >= maxMs) renewed = false;
        void connect();
      }, backoff);
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    },
  };
}
