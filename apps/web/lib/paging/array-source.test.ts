import { describe, it, expect } from "vitest";
import { arraySource } from "./array-source";

/**
 * A list held whole in the browser, served to `usePager` as pages — so it
 * pages and reads exactly like a server list under the same panel.
 */
describe("arraySource", () => {
  it("cuts the rows into pages of the given size", () => {
    expect(arraySource([1, 2, 3, 4, 5], 2).pages).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("has every page already — nothing past the last", () => {
    const src = arraySource([1, 2, 3], 2);
    expect(src.hasNextPage).toBe(false);
    expect(src.isFetchingNextPage).toBe(false);
  });

  it("is one empty page for no rows, and says when it is still loading", () => {
    expect(arraySource([], 25).pages).toEqual([]);
    expect(arraySource([], 25, true).isLoading).toBe(true);
  });
});
