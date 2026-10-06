import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { settled, usePageReady } from "./use-page-ready";

const q = (over: Partial<Parameters<typeof settled>[0]>) => ({
  data: undefined,
  isError: false,
  isPending: true,
  fetchStatus: "fetching" as const,
  ...over,
});

describe("settled", () => {
  it("is in once it answered, failed, or was never going to be asked", () => {
    expect(settled(q({ data: [], isPending: false, fetchStatus: "idle" }))).toBe(true);
    expect(settled(q({ isError: true, isPending: false, fetchStatus: "idle" }))).toBe(true);
    expect(settled(q({ fetchStatus: "idle" }))).toBe(true); // disabled
    expect(settled(q({}))).toBe(false); // on its way
  });
});

/**
 * Behind a page's one skeleton there is often a draft. Once the page is up a
 * refetch, or a key that changed after a save, must not take it away again.
 */
describe("usePageReady", () => {
  it("is not ready until everything is in", () => {
    const { result } = renderHook(() => usePageReady(false));
    expect(result.current).toBe(false);
  });

  it("stays ready once it has been", () => {
    const { result, rerender } = renderHook(({ allIn }) => usePageReady(allIn), { initialProps: { allIn: true } });
    rerender({ allIn: false });
    expect(result.current).toBe(true);
  });

  it("starts over for another key — a new list is its own first paint", () => {
    const { result, rerender } = renderHook(({ allIn, k }) => usePageReady(allIn, k), {
      initialProps: { allIn: true, k: "a" },
    });
    rerender({ allIn: false, k: "b" });
    expect(result.current).toBe(false);
    rerender({ allIn: true, k: "b" });
    expect(result.current).toBe(true);
  });
});
