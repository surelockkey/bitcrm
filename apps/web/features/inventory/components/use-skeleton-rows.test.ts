import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSkeletonRows } from "./use-skeleton-rows";

/**
 * How many skeleton rows a list draws before its first page lands. A page's
 * worth is right for the items catalogue and wrong for three warehouses: 50
 * placeholder rows collapsing to 3 is the very jump a skeleton is there to
 * prevent. So: the count when the server has said it, else the rows this
 * list showed last time, else a page.
 */
describe("useSkeletonRows", () => {
  beforeEach(() => localStorage.clear());

  it("draws a whole page the first time, knowing nothing", () => {
    const { result } = renderHook(() => useSkeletonRows("w", 50, undefined, undefined));
    expect(result.current).toBe(50);
  });

  it("draws exactly the rows the count promises, when the count came first", () => {
    const { result } = renderHook(() => useSkeletonRows("w", 50, 3, undefined));
    expect(result.current).toBe(3);
  });

  it("never more than a page, however many there are", () => {
    const { result } = renderHook(() => useSkeletonRows("w", 25, 3102, undefined));
    expect(result.current).toBe(25);
  });

  it("remembers how many rows the list showed, for the next visit", () => {
    const first = renderHook(() => useSkeletonRows("w", 50, undefined, 3));
    first.unmount();

    const { result } = renderHook(() => useSkeletonRows("w", 50, undefined, undefined));
    expect(result.current).toBe(3);
  });

  it("keeps each list's memory apart", () => {
    renderHook(() => useSkeletonRows("w", 50, undefined, 3)).unmount();
    const { result } = renderHook(() => useSkeletonRows("vans", 50, undefined, undefined));
    expect(result.current).toBe(50);
  });

  it("is at least one row — an empty list still has a first frame", () => {
    const { result } = renderHook(() => useSkeletonRows("w", 50, 0, undefined));
    expect(result.current).toBe(1);
  });

  it("still works where storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useSkeletonRows("w", 50, undefined, 7));
    expect(result.current).toBe(50);
    vi.restoreAllMocks();
  });
});
