"use client";

/**
 * Which browser tab owns the phone.
 *
 * A live call's audio belongs to one document — a MediaStream can't be handed
 * between tabs, and the Twilio Device can't live in a SharedWorker because
 * worker scope has no getUserMedia. So rather than let every tab register its
 * own Device (three tabs, three registrations, three presence heartbeats, and
 * an open question about which one an incoming call rings), exactly one tab
 * holds the phone and the others mirror it.
 *
 * Ownership is a Web Locks lock held for the tab's lifetime: the browser hands
 * it to the next waiter the moment the holder goes away — crash, close or
 * refresh alike — with no heartbeat to tune and no stale-owner window. Where
 * Web Locks is missing, every tab owns the phone, which is exactly today's
 * behaviour.
 */

const LOCK_NAME = "bitcrm-softphone-owner";
const CHANNEL = "bitcrm-softphone";

type Listener = (isOwner: boolean) => void;

let owner = false;
let claimed = false;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

/** Messages tabs send each other. Server state travels over HTTP, not here. */
export type TabMessage =
  | { type: "owner-changed"; owner: boolean }
  /** The owner's local call state changed — followers refetch rather than trust this. */
  | { type: "call-changed" };

function setOwner(next: boolean) {
  if (owner === next) return;
  owner = next;
  for (const listener of listeners) listener(owner);
}

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

/**
 * Start competing for ownership. Resolves as soon as this tab's standing is
 * known; the lock itself is held until the tab closes.
 */
export function claimOwnership(): void {
  if (claimed) return;
  claimed = true;

  if (typeof navigator === "undefined" || !navigator.locks) {
    // No Web Locks: every tab owns its own phone, as before.
    setOwner(true);
    return;
  }

  void navigator.locks.request(LOCK_NAME, () => {
    setOwner(true);
    broadcast({ type: "owner-changed", owner: true });
    // Never resolves: holding the promise holds the lock, and the browser
    // releases it for us when this tab goes away.
    return new Promise<never>(() => {});
  });
}

export function isOwnerTab(): boolean {
  return owner;
}

export function onOwnershipChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
