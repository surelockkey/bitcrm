import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { createDealChangeBatcher, parseDealFrame } from "./live";

describe("parseDealFrame", () => {
  it("reads a deal.changed frame", () => {
    expect(parseDealFrame('{"type":"deal.changed","dealId":"d1","at":"t"}')).toEqual({
      type: "deal.changed",
      dealId: "d1",
      at: "t",
    });
  });

  it("drops malformed JSON, other types and a frame without an id", () => {
    expect(parseDealFrame("not json")).toBeNull();
    expect(parseDealFrame("null")).toBeNull();
    expect(parseDealFrame('{"type":"call.upserted"}')).toBeNull();
    expect(parseDealFrame('{"type":"deal.changed"}')).toBeNull();
  });
});

describe("createDealChangeBatcher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("collapses a burst of changes into one refetch of what shows jobs", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const batcher = createDealChangeBatcher(qc, 500);

    batcher.changed();
    batcher.changed();
    batcher.changed();
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.deals.all() });

    batcher.changed();
    vi.advanceTimersByTime(500);
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("forgets a pending refetch once disposed", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const batcher = createDealChangeBatcher(qc, 500);

    batcher.changed();
    batcher.dispose();
    vi.advanceTimersByTime(1_000);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
