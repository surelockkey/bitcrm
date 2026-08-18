import { describe, it, expect, vi, beforeEach } from "vitest";
import { broadcast, onMessage } from "./tab-coordinator";

/**
 * The bus exists for one job: a tab that hangs up tells the others to recheck,
 * so nobody is left offering a call that has ended. It must also be harmless in
 * a browser without BroadcastChannel, because the phone still has to work there.
 */
describe("tab-coordinator", () => {
  beforeEach(() => vi.resetModules());

  it("delivers a message to another tab", async () => {
    const other = new BroadcastChannel("bitcrm-softphone");
    const seen: unknown[] = [];
    other.addEventListener("message", (e: MessageEvent) => seen.push(e.data));

    broadcast({ type: "call-changed" });
    // Delivery is a task, not synchronous.
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([{ type: "call-changed" }]);
    other.close();
  });

  it("does not deliver a tab's own message back to itself", async () => {
    const seen: unknown[] = [];
    const stop = onMessage((m) => seen.push(m));

    broadcast({ type: "call-changed" });
    await new Promise((r) => setTimeout(r, 0));

    // A channel never receives its own posts — the tab that hung up already
    // knows, and re-entering would loop.
    expect(seen).toEqual([]);
    stop();
  });

  it("unsubscribes cleanly", async () => {
    const other = new BroadcastChannel("bitcrm-softphone");
    const seen: unknown[] = [];
    const stop = onMessage((m) => seen.push(m));
    stop();

    other.postMessage({ type: "call-changed" });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual([]);
    other.close();
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
