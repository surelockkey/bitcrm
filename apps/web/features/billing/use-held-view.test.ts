import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { heldPager, useHeldView } from "./use-held-view";

interface Props {
  rows: string[];
  names: Map<string, string>;
  complete: boolean;
}

const render = (initial: Props) =>
  renderHook((p: Props) => useHeldView({ rows: p.rows, names: p.names }, [p.rows, p.names], p.complete), {
    initialProps: initial,
  });

describe("useHeldView", () => {
  it("has nothing to show until the first complete view", () => {
    const { result } = render({ rows: [], names: new Map(), complete: false });
    expect(result.current.shown).toBe(false);
    expect(result.current.held).toBe(false);
  });

  it("shows a complete view as it is", () => {
    const rows = ["a"];
    const names = new Map([["a", "Ann"]]);
    const { result } = render({ rows, names, complete: true });
    expect(result.current).toEqual({ view: { rows, names }, shown: true, held: false });
  });

  it("holds the last complete view while the next one is incomplete", () => {
    const rows = ["a"];
    const names = new Map([["a", "Ann"]]);
    const { result, rerender } = render({ rows, names, complete: true });

    // The next set's rows are in, their names are not.
    rerender({ rows: ["b"], names: new Map(), complete: false });
    expect(result.current).toEqual({ view: { rows, names }, shown: true, held: true });

    const next = { rows: ["b"], names: new Map([["b", "Bo"]]) };
    rerender({ ...next, complete: true });
    expect(result.current).toEqual({ view: next, shown: true, held: false });
  });

  it("holds the latest complete view, not the first one", () => {
    const names = new Map([["a", "Ann"]]);
    const { result, rerender } = render({ rows: ["a"], names, complete: true });
    // A refetch while complete: new rows, the same names.
    const refetched = ["a", "a2"];
    rerender({ rows: refetched, names, complete: true });
    rerender({ rows: [], names: new Map(), complete: false });
    expect(result.current.view.rows).toBe(refetched);
  });
});

describe("heldPager", () => {
  it("keeps the numbers of a held pager and offers no page to go to", () => {
    const pager = { page: 3, total: 312, canPrev: true, canNext: true, isFetching: false };
    expect(heldPager(pager)).toEqual({ page: 3, total: 312, canPrev: false, canNext: false, isFetching: true });
  });
});
