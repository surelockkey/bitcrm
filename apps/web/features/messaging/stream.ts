import type { SseStreamOptions, StreamHandle } from "@/lib/sse-stream";
import { openSharedSseStream } from "@/lib/shared-sse-stream";
import type { MessagingRealtimeEvent } from "./api";

const EVENT_TYPES = new Set<MessagingRealtimeEvent["type"]>([
  "conversation.upserted",
  "message.upserted",
  "counters.changed",
  "opt_out.changed",
  "team_counters.changed",
]);

/** Cheap shape check on a `data:` frame — a malformed one is dropped, not thrown. */
export function parseRealtimeFrame(data: string): MessagingRealtimeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const type = (parsed as { type?: unknown }).type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type as MessagingRealtimeEvent["type"])) {
    return null;
  }
  return parsed as MessagingRealtimeEvent;
}

export type StreamOptions = Omit<SseStreamOptions<MessagingRealtimeEvent>, "parse">;
export type { StreamHandle };

/** The inbox stream (design §7.6), shared by every tab of the browser. */
export function openMessagingStream(opts: StreamOptions): StreamHandle {
  return openSharedSseStream("messaging", { ...opts, parse: parseRealtimeFrame });
}
