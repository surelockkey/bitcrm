import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Ownership is a Web Locks lock held for the tab's lifetime. These cover the
 * two things that actually matter: exactly one tab wins, and a browser without
 * Web Locks keeps working the way it does today.
 */
describe("tab-coordinator", () => {
  const realLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

  /** A LockManager where each name can be held by one caller at a time. */
  function fakeLocks() {
    const held = new Set<string>();
    const waiting: Array<() => void> = [];
    return {
      manager: {
        request: (name: string, fn: () => Promise<unknown>) => {
          if (held.has(name)) {
            // Queued behind the holder, exactly like the real thing.
            return new Promise(() => waiting.push(() => void fn()));
          }
          held.add(name);
          return fn();
        },
      },
      release: (name: string) => {
        held.delete(name);
        waiting.shift()?.();
      },
    };
  }

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (realLocks) Object.defineProperty(navigator, "locks", realLocks);
    else delete (navigator as { locks?: unknown }).locks;
  });

  it("hands ownership to the tab that asks first", async () => {
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", {
      value: locks.manager,
      configurable: true,
    });

    const first = await import("./tab-coordinator");
    first.claimOwnership();
    await Promise.resolve();
    expect(first.isOwnerTab()).toBe(true);

    // A second tab is a second module instance competing for the same lock.
    vi.resetModules();
    const second = await import("./tab-coordinator");
    second.claimOwnership();
    await Promise.resolve();
    expect(second.isOwnerTab()).toBe(false);
  });

  it("notifies when this tab becomes the owner", async () => {
    const locks = fakeLocks();
    Object.defineProperty(navigator, "locks", {
      value: locks.manager,
      configurable: true,
    });

    const mod = await import("./tab-coordinator");
    const seen: boolean[] = [];
    mod.onOwnershipChange((owner) => seen.push(owner));
    mod.claimOwnership();
    await Promise.resolve();

    expect(seen).toEqual([true]);
  });

  it("claiming twice is harmless", async () => {
    const locks = fakeLocks();
    const request = vi.fn(locks.manager.request);
    Object.defineProperty(navigator, "locks", {
      value: { request },
      configurable: true,
    });

    const mod = await import("./tab-coordinator");
    mod.claimOwnership();
    mod.claimOwnership();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("falls back to every tab owning its own phone without Web Locks", async () => {
    delete (navigator as { locks?: unknown }).locks;

    const mod = await import("./tab-coordinator");
    mod.claimOwnership();

    // Today's behaviour, unchanged — better than a phone that never registers.
    expect(mod.isOwnerTab()).toBe(true);
  });

  it("survives a browser with no BroadcastChannel", async () => {
    const real = globalThis.BroadcastChannel;
    // @ts-expect-error — removing it is the point
    delete globalThis.BroadcastChannel;
    try {
      const mod = await import("./tab-coordinator");
      expect(() => mod.broadcast({ type: "call-changed" })).not.toThrow();
      expect(mod.onMessage(() => {})).toBeInstanceOf(Function);
    } finally {
      globalThis.BroadcastChannel = real;
    }
  });
});
