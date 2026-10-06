import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useImagesReady } from "./use-images-ready";

/** jsdom never loads an image: a stand-in that loads or fails on command. */
const made: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    made.push({ src: value, onload: () => this.onload?.(), onerror: () => this.onerror?.() });
  }
}

describe("useImagesReady", () => {
  beforeEach(() => {
    made.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is ready at once with nothing to load", () => {
    expect(renderHook(() => useImagesReady([])).result.current).toBe(true);
  });

  it("waits until every picture has loaded or failed", () => {
    const { result } = renderHook(() => useImagesReady(["a.png", "b.png"]));
    expect(result.current).toBe(false);
    act(() => made.find((m) => m.src === "a.png")!.onload!());
    expect(result.current).toBe(false);
    act(() => made.find((m) => m.src === "b.png")!.onerror!());
    expect(result.current).toBe(true);
  });

  it("holds the page no longer than the timeout", () => {
    const { result } = renderHook(() => useImagesReady(["slow.png"], 2000));
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(true);
  });
});
