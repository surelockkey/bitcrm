import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useElementWidth } from "./canvas";

/**
 * The paper is fitted to the canvas's width, read twice: once as the canvas
 * is attached (before the first paint) and then by a ResizeObserver. The first
 * read counted the canvas's padding and the observer did not, so the paper was
 * fitted at one size and re-fitted at another a frame later — every section
 * shrank and slid. Both reads now measure the same box.
 */
describe("useElementWidth", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the same width before the first paint as the observer reports after", async () => {
    const seen: number[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: ResizeObserverCallback) {}
        observe(el: Element) {
          // What the browser reports, after the frame is painted: the content
          // box, padding excluded.
          setTimeout(() => this.cb([{ target: el, contentRect: { width: 808 } } as unknown as ResizeObserverEntry], this as never), 0);
        }
        disconnect() {}
      },
    );
    function Probe() {
      const { ref, width } = useElementWidth<HTMLDivElement>();
      if (width) seen.push(width);
      return <div ref={ref} style={{ paddingLeft: "16px", paddingRight: "16px" }} />;
    }
    const realRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { width: 840, height: 10, x: 0, y: 0, top: 0, left: 0, right: 840, bottom: 10, toJSON: () => ({}) } as DOMRect;
    };
    try {
      render(<Probe />);
      await act(() => new Promise((r) => setTimeout(r, 10)));
    } finally {
      HTMLElement.prototype.getBoundingClientRect = realRect;
    }

    expect(new Set(seen)).toEqual(new Set([808]));
  });
});
