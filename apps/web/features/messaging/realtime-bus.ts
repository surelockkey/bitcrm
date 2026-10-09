import type { MessagingRealtimeEvent } from "./api";

/*
 * The messaging stream is one connection per browser (`use-messaging-stream`),
 * and its frames go straight into the query cache. Anything else that wants
 * to hear a frame as it lands — the on-screen notifications — listens here
 * rather than opening a stream of its own (a second stream would hold a
 * second HTTP/1.1 connection for good; see `shared-sse-stream.ts`).
 */

export type RealtimeListener = (event: MessagingRealtimeEvent) => void;

const listeners = new Set<RealtimeListener>();

/** Hear every frame from now on; the returned function stops it. */
export function subscribeRealtimeEvents(listener: RealtimeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the stream hook for each frame. A listener that throws stops nobody else. */
export function publishRealtimeEvent(event: MessagingRealtimeEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      console.error("realtime listener failed", error);
    }
  }
}
