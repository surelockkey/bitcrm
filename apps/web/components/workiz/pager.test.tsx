import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzPager, wzPagerPages, wzPagerSummary } from "./pager";

describe("wzPagerSummary — Workiz's footer words", () => {
  it("reads like list_07_bottom", () => {
    expect(wzPagerSummary({ from: 1, to: 50, total: 208 })).toBe("Showing 1 to 50 of 208 results");
  });

  it("says 1 to 0 of 0 for an empty list, as Workiz does", () => {
    expect(wzPagerSummary({ from: 0, to: 0, total: 0 })).toBe("Showing 1 to 0 of 0 results");
  });

  it("groups thousands and marks a floor", () => {
    expect(wzPagerSummary({ from: 51, to: 100, total: 8806 })).toBe("Showing 51 to 100 of 8,806 results");
    expect(wzPagerSummary({ from: 1, to: 50, total: 10000, totalIsFloor: true })).toBe(
      "Showing 1 to 50 of 10,000+ results",
    );
  });

  it("leaves the total out when nobody counted", () => {
    expect(wzPagerSummary({ from: 1, to: 50, total: undefined })).toBe("Showing 1 to 50 results");
    expect(wzPagerSummary({ from: 1, to: 50, total: null })).toBe("Showing 1 to 50 results");
  });
});

describe("wzPagerPages — the words between ‹ and ›", () => {
  it("names the page and the count", () => {
    expect(wzPagerPages({ page: 1, totalPages: 881 })).toBe("Page 1 of 881");
    expect(wzPagerPages({ page: 2, totalPages: 1234 })).toBe("Page 2 of 1,234");
  });

  it("never says 'of 0' — an empty list is Page 1 of 1", () => {
    expect(wzPagerPages({ page: 1, totalPages: 0 })).toBe("Page 1 of 1");
  });

  it("marks a floor, and says just the page when the count is unknown", () => {
    expect(wzPagerPages({ page: 1, totalPages: 200, totalPagesIsFloor: true })).toBe("Page 1 of 200+");
    expect(wzPagerPages({ page: 3 })).toBe("Page 3");
  });
});

describe("WzPager", () => {
  const base = {
    page: 1,
    from: 1,
    to: 50,
    total: 208,
    totalPages: 5,
    canPrev: false,
    canNext: true,
    isFetching: false,
    prev: vi.fn(),
    next: vi.fn(async () => {}),
  };

  it("draws the words and two round buttons that page", async () => {
    const next = vi.fn(async () => {});
    render(<WzPager pager={{ ...base, next }} />);
    expect(screen.getByText("Showing 1 to 50 of 208 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 5")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(next).toHaveBeenCalled();
  });

  it("keeps ‹ looking the same on page 1 (Workiz never fades it) but makes it inert", () => {
    render(<WzPager pager={base} />);
    const prev = screen.getByRole("button", { name: "Previous page" });
    expect(prev).toBeDisabled();
    expect(prev.className).not.toMatch(/disabled:opacity/);
  });

  it("holds › while the next page is on its way", () => {
    render(<WzPager pager={{ ...base, isFetching: true }} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  });

  it("puts whatever it is given at the right end (the page size)", () => {
    render(<WzPager pager={base} end={<span>Rows</span>} />);
    expect(screen.getByText("Rows")).toBeInTheDocument();
  });
});
