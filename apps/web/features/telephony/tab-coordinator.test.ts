import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Ownership is a Web Locks lock. These cover what actually matters: exactly one
 * tab wins, the phone moves to whichever tab wants to dial, a tab on a call
 * keeps it, and a browser without Web Locks works the way it always did.
 */
describe("tab-coordinator", () => {
  const realLocks = Object.getOwnPropertyDescriptor(navigator, "locks");

  /**
   * A LockManager where each name is held by one caller at a time, queueing
   * the rest — and where releasing hands it to the next in line, which is the
   * behaviour the polite hand-over depends on.
   */
  function fakeLocks() {
    const held = new Set<string>();
    const waiting: Array<() => void> = [];

    type Cb = () => Promise<unknown>;
    const request = (
      name: string,
      optionsOrCb: { steal?: boolean } | Cb,
      maybeCb?: Cb,
    ) => {
      const options = typeof optionsOrCb === "function" ? {} : optionsOrCb;
      const cb = (typeof optionsOrCb === "function" ? optionsOrCb : maybeCb)!;

      const grant = () => {
        held.add(name);
        // The holder's promise resolving is what releases the lock.
        return cb().then(() => {
          held.delete(name);
          waiting.shift()?.();
        });
      };

      if (options.steal) {
        held.delete(name);
        return grant();
      }
      if (held.has(name)) return new Promise(() => waiting.push(() => void grant()));
      return grant();
    };

    return { manager: { request } };
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

  describe("moving the phone to the tab that wants to dial", () => {
    /**
     * A stand-in for the other tab: holds the lock and answers on its own
     * BroadcastChannel — a channel never receives its own posts, so the reply
     * has to come from a separate instance to reach the tab under test.
     */
    function otherTabOwning(opts: { busy: boolean }) {
      let release: (() => void) | null = null;
      void (navigator.locks as unknown as {
        request: (n: string, o: unknown, cb: () => Promise<unknown>) => unknown;
      }).request("bitcrm-softphone-owner", {}, () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const channel = new BroadcastChannel("bitcrm-softphone");
      channel.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type !== "yield-phone") return;
        if (opts.busy) channel.postMessage({ type: "phone-busy" });
        else release?.();
      });
      return () => channel.close();
    }

    it("hands the phone over when the other tab is idle", async () => {
      Object.defineProperty(navigator, "locks", {
        value: fakeLocks().manager,
        configurable: true,
      });
      const mod = await import("./tab-coordinator");
      const stop = otherTabOwning({ busy: false });

      mod.claimOwnership();
      await Promise.resolve();
      expect(mod.isOwnerTab()).toBe(false);

      // Dialling here asks for the phone; the idle owner lets it go.
      const got = await mod.requestPhone();
      expect(got).toBe(true);
      expect(mod.isOwnerTab()).toBe(true);
      stop();
    });

    it("refuses while the other tab is on a call — taking the call is the way", async () => {
      Object.defineProperty(navigator, "locks", {
        value: fakeLocks().manager,
        configurable: true,
      });
      const mod = await import("./tab-coordinator");
      const stop = otherTabOwning({ busy: true });

      mod.claimOwnership();
      await Promise.resolve();

      const got = await mod.requestPhone();
      expect(got).toBe(false);
      expect(mod.isOwnerTab()).toBe(false);
      stop();
    });

    it("is a no-op for the tab that already has it", async () => {
      Object.defineProperty(navigator, "locks", {
        value: fakeLocks().manager,
        configurable: true,
      });
      const mod = await import("./tab-coordinator");
      mod.claimOwnership();
      await Promise.resolve();

      await expect(mod.requestPhone()).resolves.toBe(true);
    });
  });
});
