import { describe, it, expect } from "vitest";
import { pagedSource } from "./paged-source";

/**
 * Перехідник від `useInfiniteQuery` до пейджера: сторінки сервісів приходять
 * як `{ data, pagination }`, а пейджеру потрібні самі рядки.
 */
describe("pagedSource", () => {
  const query = {
    data: { pages: [{ data: [1, 2] }, { data: [3] }] },
    hasNextPage: true,
    isFetchingNextPage: false,
    isLoading: false,
    fetchNextPage: async () => ({}),
  };

  it("hands over the rows of each page, in order", () => {
    expect(pagedSource(query).pages).toEqual([[1, 2], [3]]);
  });

  it("reads as empty before the first answer arrives", () => {
    expect(pagedSource({ ...query, data: undefined }).pages).toEqual([]);
  });

  it("carries the query's own state through", () => {
    const src = pagedSource({ ...query, isLoading: true, hasNextPage: false });

    expect(src.isLoading).toBe(true);
    expect(src.hasNextPage).toBe(false);
  });
})
