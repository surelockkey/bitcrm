import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLocationBroadcast } from "./use-location-broadcast";
import * as api from "./api";

vi.mock("./api", () => ({
  postLocation: vi.fn().mockResolvedValue({}),
  clearLocation: vi.fn().mockResolvedValue(undefined),
}));

/** A controllable stand-in for navigator.geolocation. */
function fakeGeolocation() {
  let onFix: PositionCallback | null = null;
  const clearWatch = vi.fn();
  const watchPosition = vi.fn((success: PositionCallback) => {
    onFix = success;
    return 1;
  });
  const fix = (lat: number, lng: number, accuracy = 10) =>
    onFix?.({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
  return { watchPosition, clearWatch, fix };
}

let geo: ReturnType<typeof fakeGeolocation>;

function setGeolocation(value: unknown) {
  Object.defineProperty(navigator, "geolocation", {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  geo = fakeGeolocation();
  setGeolocation(geo);
  vi.mocked(api.postLocation).mockClear();
  vi.mocked(api.clearLocation).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  setGeolocation(undefined);
});

describe("useLocationBroadcast", () => {
  it("starts watching position when enabled", () => {
    renderHook(() => useLocationBroadcast("tech-1", true));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
  });

  it("does not watch when disabled", () => {
    renderHook(() => useLocationBroadcast("tech-1", false));
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("does nothing without a technician id", () => {
    renderHook(() => useLocationBroadcast(undefined, true));
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it("posts the technician's own coordinates on a fix", () => {
    renderHook(() => useLocationBroadcast("tech-1", true));
    geo.fix(33.749, -84.388, 8);
    expect(api.postLocation).toHaveBeenCalledWith("tech-1", {
      lat: 33.749,
      lng: -84.388,
      accuracy: 8,
    });
  });

  // watchPosition can fire every second; the backend TTL is minutes, so we must
  // not hammer the endpoint with every jitter.
  it("throttles rapid fixes", () => {
    renderHook(() => useLocationBroadcast("tech-1", true));

    geo.fix(1, 1);
    geo.fix(1.0001, 1.0001); // moments later
    expect(api.postLocation).toHaveBeenCalledTimes(1);

    vi.setSystemTime(30_000); // well past the throttle window
    geo.fix(2, 2);
    expect(api.postLocation).toHaveBeenCalledTimes(2);
  });

  it("stops watching and goes offline on unmount", () => {
    const { unmount } = renderHook(() => useLocationBroadcast("tech-1", true));
    unmount();
    expect(geo.clearWatch).toHaveBeenCalledWith(1);
    expect(api.clearLocation).toHaveBeenCalledWith("tech-1");
  });

  it("does not throw where geolocation is unavailable", () => {
    setGeolocation(undefined);
    expect(() => renderHook(() => useLocationBroadcast("tech-1", true))).not.toThrow();
    expect(api.postLocation).not.toHaveBeenCalled();
  });
});
