"use client";

import { useSoftphoneStore } from "./softphone-store";

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
 * Ownership is a Web Locks lock: the browser hands it to the next waiter the
 * moment the holder goes away — crash, close or refresh alike — with no
 * heartbeat to tune and no stale-owner window.
 *
 * It also moves on demand. Owning the phone is not a prize for opening a tab
 * first: dial in any tab and it asks the current owner to hand over, which the
 * owner does unless it is on a call. Where Web Locks is missing, every tab
 * owns its own phone, which is exactly the old behaviour.
 */

const LOCK_NAME = "bitcrm-softphone-owner";
const CHANNEL = "bitcrm-softphone";
/** How long to wait for a polite hand-over before assuming the tab is gone. */
const YIELD_TIMEOUT_MS = 2_000;

type Listener = (isOwner: boolean) => void;

let owner = false;
let claimed = false;
/** Resolving this releases the lock — how a tab gives the phone up on request. */
let release: (() => void) | null = null;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

export type TabMessage =
  /** Somebody wants the phone. The owner yields unless it's on a call. */
  | { type: "yield-phone" }
  /** The owner is on a call and is keeping it. */
  | { type: "phone-busy" }
  | { type: "owner-changed"; owner: boolean }
  /** Local call state changed — other tabs should refetch, not trust this. */
  | { type: "call-changed" };

function hasLocks(): boolean {
  return typeof navigator !== "undefined" && !!navigator.locks;
}

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

/** Hold the lock until somebody asks for it or this tab goes away. */
function acquire(steal = false): void {
  void navigator.locks
    .request(LOCK_NAME, steal ? { steal: true } : {}, () => {
      setOwner(true);
      broadcast({ type: "owner-changed", owner: true });
      return new Promise<void>((resolve) => {
        release = resolve;
      }).then(() => {
        release = null;
        setOwner(false);
        // Straight back into the queue: yielding the phone is not leaving it.
        acquire();
      });
    })
    .catch(() => {
      // A stolen lock rejects the old holder's request; it has already been
      // told it is no longer the owner by the release path.
      release = null;
      setOwner(false);
    });
}

/**
 * Start competing for ownership, and answer other tabs that want the phone.
 * Safe to call from every tab, repeatedly.
 */
export function claimOwnership(): void {
  if (claimed) return;
  claimed = true;

  if (!hasLocks()) {
    // No Web Locks: every tab owns its own phone, as before.
    setOwner(true);
    return;
  }

  onMessage((message) => {
    if (message.type !== "yield-phone" || !owner) return;
    // A tab on a call keeps the phone — handing it over would drop the audio
    // mid-sentence. The asking tab is told, and offers to take the call
    // properly instead.
    if (useSoftphoneStore.getState().callState !== "idle") {
      broadcast({ type: "phone-busy" });
      return;
    }
    release?.();
  });

  acquire();
}

/**
 * Get the phone into this tab so it can dial.
 *
 * Resolves true once this tab owns it. False means the owner is mid-call and
 * kept it — the caller should offer to take the call over instead, which moves
 * the audio properly rather than yanking the Device out from under it.
 */
export function requestPhone(): Promise<boolean> {
  if (owner) return Promise.resolve(true);
  if (!hasLocks()) return Promise.resolve(true);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (got: boolean) => {
      if (settled) return;
      settled = true;
      stopOwner();
      stopMessage();
      clearTimeout(timer);
      resolve(got);
    };

    const stopOwner = onOwnershipChange((isOwner) => {
      if (isOwner) finish(true);
    });
    const stopMessage = onMessage((message) => {
      if (message.type === "phone-busy") finish(false);
    });

    // If nobody answers, the holder is gone or wedged — take it outright.
    const timer = setTimeout(() => {
      if (!settled) acquire(true);
      setTimeout(() => finish(owner), 300);
    }, YIELD_TIMEOUT_MS);

    broadcast({ type: "yield-phone" });
  });
}

export function isOwnerTab(): boolean {
  return owner;
}

export function onOwnershipChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
