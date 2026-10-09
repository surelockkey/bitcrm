import { describe, expect, it, vi } from "vitest";
import type { MessagingRealtimeEvent } from "./api";
import { publishRealtimeEvent, subscribeRealtimeEvents } from "./realtime-bus";

const event = { type: "counters.changed", at: "", counters: {} } as unknown as MessagingRealtimeEvent;

describe("the realtime bus", () => {
  it("hands every frame to each listener until it unsubscribes", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeRealtimeEvents(a);
    subscribeRealtimeEvents(b);
    publishRealtimeEvent(event);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledWith(event);
    offA();
    publishRealtimeEvent(event);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("lets one listener's error stop neither the others nor the stream", () => {
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();
    const offBad = subscribeRealtimeEvents(bad);
    const offGood = subscribeRealtimeEvents(good);
    expect(() => publishRealtimeEvent(event)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    offBad();
    offGood();
  });
});
