import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMarkerClusterer } from "./use-marker-clusterer";

// The hook builds a MarkerClusterer from the map; there's no map in jsdom, so
// stub the module. useMap returns null → the clusterer instance is never made,
// which is fine: this test is about the ref-callback identity, not clustering.
vi.mock("@vis.gl/react-google-maps", () => ({ useMap: () => null }));
vi.mock("@googlemaps/markerclusterer", () => ({
  MarkerClusterer: class {
    clearMarkers() {}
    addMarkers() {}
  },
}));

describe("useMarkerClusterer", () => {
  /**
   * The root cause of the "Maximum update depth exceeded" crash: an unstable ref
   * callback. React re-attaches a ref whose identity changed, and each attach
   * sets state — so if the callback is new every render, it loops forever. The
   * callback for a given pin id must be the same function across renders.
   */
  it("returns the same ref callback for an id across renders", () => {
    const { result, rerender } = renderHook(() => useMarkerClusterer());

    const first = result.current.markerRef("deal-1");
    rerender();
    const second = result.current.markerRef("deal-1");

    expect(second).toBe(first);
  });

  it("gives different ids their own callbacks", () => {
    const { result } = renderHook(() => useMarkerClusterer());

    expect(result.current.markerRef("deal-1")).not.toBe(result.current.markerRef("deal-2"));
  });

  it("keeps each id's callback stable independently", () => {
    const { result, rerender } = renderHook(() => useMarkerClusterer());

    const a1 = result.current.markerRef("a");
    const b1 = result.current.markerRef("b");
    rerender();

    expect(result.current.markerRef("a")).toBe(a1);
    expect(result.current.markerRef("b")).toBe(b1);
  });
});
