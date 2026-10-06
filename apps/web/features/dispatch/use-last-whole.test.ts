import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useLastWhole } from "./use-last-whole";

/**
 * A board whose window changed — another day, another set of statuses — is
 * asked for again, and for a moment holds the new jobs without their clients'
 * names. The screen must keep what it showed until the new answer is whole.
 */
describe("useLastWhole", () => {
  const a = { day: "mon" };
  const b = { day: "tue" };

  it("has nothing to show before anything was whole", () => {
    const { result } = renderHook(() => useLastWhole(a, false));
    expect(result.current).toBeUndefined();
  });

  it("shows the answer once it is whole", () => {
    const { result } = renderHook(() => useLastWhole(a, true));
    expect(result.current).toBe(a);
  });

  it("keeps the last whole answer while the next one is still coming in", () => {
    const { result, rerender } = renderHook(({ v, whole }) => useLastWhole(v, whole), {
      initialProps: { v: a, whole: true },
    });
    rerender({ v: b, whole: false });
    expect(result.current).toBe(a);
    rerender({ v: b, whole: true });
    expect(result.current).toBe(b);
  });

  it("does not hand back an older answer once a newer one was shown", () => {
    const { result, rerender } = renderHook(({ v, whole }) => useLastWhole(v, whole), {
      initialProps: { v: a, whole: true },
    });
    rerender({ v: b, whole: true });
    rerender({ v: a, whole: false });
    expect(result.current).toBe(b);
  });
});
