import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Admin → Users "Online": the server marks a user active on every signed-in
 * request, and someone reading a page makes none — so an open tab says it is
 * still in use once a minute, but only while it is in view.
 */
const api = vi.hoisted(() => ({ sendHeartbeat: vi.fn(async () => undefined) }));
vi.mock("./api", () => api);

import { HEARTBEAT_MS, usePresenceHeartbeat } from "./use-presence-heartbeat";

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (v: DocumentVisibilityState) => {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  api.sendHeartbeat.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePresenceHeartbeat", () => {
  it("beats as the app opens, then once a minute while the tab is in view", () => {
    renderHook(() => usePresenceHeartbeat(true));
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(HEARTBEAT_MS);
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(3);
  });

  it("stays quiet while the tab is hidden, and beats again as it comes back", () => {
    renderHook(() => usePresenceHeartbeat(true));
    setVisibility("hidden");
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(1);

    setVisibility("visible");
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(2);
  });

  it("flicking between tabs does not send a beat each time", () => {
    renderHook(() => usePresenceHeartbeat(true));
    setVisibility("hidden");
    setVisibility("visible");
    setVisibility("hidden");
    setVisibility("visible");
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("nothing before anyone is signed in, and nothing after the app closes", () => {
    const { rerender, unmount } = renderHook(({ on }) => usePresenceHeartbeat(on), { initialProps: { on: false } });
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(api.sendHeartbeat).not.toHaveBeenCalled();

    rerender({ on: true });
    unmount();
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(api.sendHeartbeat).toHaveBeenCalledTimes(1);
  });

  it("a failed beat is not an error anyone sees", async () => {
    api.sendHeartbeat.mockRejectedValueOnce(new Error("offline"));
    expect(() => renderHook(() => usePresenceHeartbeat(true))).not.toThrow();
    await vi.runOnlyPendingTimersAsync();
  });
});
