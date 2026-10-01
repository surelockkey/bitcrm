import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListBody } from "./list-body";

/**
 * jsdom lays nothing out: the list's area reports the box a test gives it —
 * its top on screen and its height — the way a browser would.
 */
const box = { top: 180, height: 2490 };
const area = () => document.querySelector("[data-slot=list-area]") as HTMLElement;

let scrolled: ReturnType<typeof vi.fn>;

beforeEach(() => {
  box.top = 180;
  box.height = 2490;
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.dataset.slot !== "list-area") return new DOMRect(0, 0, 0, 0);
    return new DOMRect(0, box.top, 1000, box.height);
  });
  scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled as unknown as Element["scrollIntoView"];
});

afterEach(() => {
  vi.restoreAllMocks();
});

function list(filter: string, page = 1) {
  return (
    <ListBody holdKey={filter} scrollKey={String(page)} pager={<div data-testid="pager" />}>
      <table />
    </ListBody>
  );
}

/**
 * Search CLS on Items (0.048 desktop, 0.059 phone): 50 rows became 2 and the
 * pager, below the fold, jumped up into view; the next search sent it back.
 */
describe("ListBody — a new search doesn't pull the pager up", () => {
  it("holds the area at the part of the screen it filled, when the filter changes", () => {
    const { rerender } = render(list("a"));
    expect(area().style.minHeight).toBe("");

    rerender(list("b"));
    // 2490px tall from 180px down a 1000px screen: 820px of it was on screen.
    expect(area().style.minHeight).toBe("820px");
  });

  it("holds a short list at its own height, so its pager stays where it was", () => {
    box.height = 200;
    const { rerender } = render(list("a"));
    rerender(list("b"));
    expect(area().style.minHeight).toBe("200px");
  });

  it("holds nothing for a list scrolled out of sight below", () => {
    box.top = 1200;
    const { rerender } = render(list("a"));
    rerender(list("b"));
    expect(area().style.minHeight).toBe("");
  });

  it("holds nothing while the filter stays — a new page is not a new search", () => {
    const { rerender } = render(list("a", 1));
    rerender(list("a", 2));
    expect(area().style.minHeight).toBe("");
  });

  it("measures again at the next search rather than keep the old hold", () => {
    const { rerender } = render(list("a"));
    rerender(list("b"));
    expect(area().style.minHeight).toBe("820px");

    // The reader scrolled: the list now starts 400px down.
    box.top = 400;
    rerender(list("c"));
    expect(area().style.minHeight).toBe("600px");
  });

  it("keeps the pager under the held area, not inside it", () => {
    render(list("a"));
    expect(area()).not.toContainElement(screen.getByTestId("pager"));
    expect(area().querySelector("table")).not.toBeNull();
  });
});

/** After Next the view stayed at the bottom: the new page's top was 1572px above the screen. */
describe("ListBody — a new page starts at its top", () => {
  it("scrolls the list's top into view, smoothly, when it is above the screen", () => {
    box.top = -1572;
    const { rerender } = render(list("a", 1));
    rerender(list("a", 2));
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });

  it("leaves the view alone when the list's top is on screen", () => {
    box.top = 180;
    const { rerender } = render(list("a", 1));
    rerender(list("a", 2));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("does not scroll on the first frame", () => {
    box.top = -1572;
    render(list("a", 3));
    expect(scrolled).not.toHaveBeenCalled();
  });

  it("clears the sticky header — the area keeps a scroll margin for it", () => {
    render(list("a"));
    expect(area().className).toMatch(/scroll-mt-/);
  });
});
