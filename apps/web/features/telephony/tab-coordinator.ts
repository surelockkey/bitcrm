"use client";

/**
 * The channel tabs use to tell each other something changed.
 *
 * Every tab with the phone switched on registers its own Twilio Device and is
 * a working phone: it shows online, it rings, and it can answer. An earlier
 * version elected a single owner tab to hold the one Device — fewer
 * registrations, deterministic ringing — but it made every other tab read
 * "offline" and refuse to dial, which is worse than the duplication it saved.
 * Presence is idempotent and a heartbeat is one small POST, so N tabs cost
 * little; a phone that doesn't ring where you're looking costs a job.
 *
 * What can't be duplicated is a live call: its audio belongs to the document
 * that answered. That's what the call hand-over is for, and why tabs still
 * need to talk — a tab that hangs up tells the others to recheck rather than
 * leaving them to offer a call that has ended.
 */

const CHANNEL = "bitcrm-softphone";

export type TabMessage =
  /** A call started or ended here — other tabs should refetch, not trust this. */
  { type: "call-changed" };

let channel: BroadcastChannel | null = null;

function bus(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  channel ??= new BroadcastChannel(CHANNEL);
  return channel;
}

/** Tell the other tabs something happened. Best-effort by design. */
export function broadcast(message: TabMessage): void {
  try {
    bus()?.postMessage(message);
  } catch {
    /* a closed channel is not worth a crash */
  }
}

export function onMessage(handler: (message: TabMessage) => void): () => void {
  const b = bus();
  if (!b) return () => {};
  const listener = (event: MessageEvent<TabMessage>) => handler(event.data);
  b.addEventListener("message", listener);
  return () => b.removeEventListener("message", listener);
}
