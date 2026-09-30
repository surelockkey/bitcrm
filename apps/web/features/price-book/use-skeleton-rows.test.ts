import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSkeletonRows } from "./use-skeleton-rows";

describe("useSkeletonRows — as many placeholder rows as the page will have", () => {
  it("takes the server's count when it has answered, capped at a page", () => {
    expect(renderHook(() => useSkeletonRows("t", 50, 12, undefined)).result.current).toBe(12);
    expect(renderHook(() => useSkeletonRows("t", 25, 900, undefined)).result.current).toBe(25);
  });

  it("draws at least one row, even for an empty list", () => {
    expect(renderHook(() => useSkeletonRows("t", 50, 0, undefined)).result.current).toBe(1);
  });

  it("starts from the rows the list showed last visit, else a page", () => {
    expect(renderHook(() => useSkeletonRows("t", 50, undefined, undefined)).result.current).toBe(50);
    renderHook(() => useSkeletonRows("t", 50, undefined, 7));
    expect(renderHook(() => useSkeletonRows("t", 50, undefined, undefined)).result.current).toBe(7);
    // Another list keeps its own memory.
    expect(renderHook(() => useSkeletonRows("u", 50, undefined, undefined)).result.current).toBe(50);
  });
});
