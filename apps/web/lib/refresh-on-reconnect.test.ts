import { describe, it, expect, vi } from "vitest";
import { refreshOnReconnect } from "./refresh-on-reconnect";

/**
 * A live stream connects a moment after the page has asked for its data. The
 * first connect has missed nothing — refreshing then asked for every list on
 * screen a second time, and anything that changed in between moved under the
 * reader. Only a connect after a drop can have missed frames.
 */
describe("refreshOnReconnect", () => {
  it("leaves the first connect alone", () => {
    const refresh = vi.fn();
    refreshOnReconnect(refresh)();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes on every connect after it", () => {
    const refresh = vi.fn();
    const onConnect = refreshOnReconnect(refresh);
    onConnect();
    onConnect();
    onConnect();
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
