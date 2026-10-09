import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzPager, wzPagerCanNext, wzPagerPages, wzPagerSummary } from "./pager";

describe("wzPagerSummary — Workiz's footer words", () => {
  it("reads like list_07_bottom", () => {
    expect(wzPagerSummary({ from: 1, to: 50, total: 208 })).toBe("Showing 1 to 50 of 208 results");
  });

  it("says 1 to 0 of 0 for an empty list, as Workiz does", () => {
    expect(wzPagerSummary({ from: 0, to: 0, total: 0 })).toBe("Showing 1 to 0 of 0 results");
  });

  // react-table prints its counts raw — "8806", "370338", "78617" — in
  // every Workiz capture (rep_activity_wz_06, app_audit 2026-10-09), so the
  // kit does by default; the separators are an opt-in nobody uses.
  it("prints thousands as Workiz does, without a separator, and marks a floor", () => {
    expect(wzPagerSummary({ from: 51, to: 100, total: 8806 })).toBe("Showing 51 to 100 of 8806 results");
    expect(wzPagerSummary({ from: 1, to: 50, total: 10000, totalIsFloor: true })).toBe(
      "Showing 1 to 50 of 10000+ results",
    );
  });

  it("groups thousands only when asked (`plainNumbers: false`)", () => {
    expect(wzPagerSummary({ from: 51, to: 100, total: 8806 }, { plainNumbers: false })).toBe(
      "Showing 51 to 100 of 8,806 results",
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
    expect(wzPagerPages({ page: 2, totalPages: 1234 })).toBe("Page 2 of 1234");
    expect(wzPagerPages({ page: 2, totalPages: 1234 }, { plainNumbers: false })).toBe("Page 2 of 1,234");
  });

  it("never says 'of 0' — an empty list is Page 1 of 1", () => {
    expect(wzPagerPages({ page: 1, totalPages: 0 })).toBe("Page 1 of 1");
  });

  it("marks a floor, and says just the page when the count is unknown", () => {
    expect(wzPagerPages({ page: 1, totalPages: 200, totalPagesIsFloor: true })).toBe("Page 1 of 200+");
    expect(wzPagerPages({ page: 3 })).toBe("Page 3");
  });
});

/**
 * Audit L8/L15 on the jobs list: with a filter chip the pager said "Page 1 of
 * 1" and still offered Next, which then read "Page 2 of 1". The count knows
 * the last page; a floor, or no count, leaves it to the cursor.
 */
describe("wzPagerCanNext — › for a list whose count knows its last page", () => {
  const p = { page: 1, canNext: true, isFetching: false, totalPages: 1 as number | undefined, totalPagesIsFloor: false };

  it("stops on the counted last page, even with a cursor in hand", () => {
    expect(wzPagerCanNext(p)).toBe(false);
    expect(wzPagerCanNext({ ...p, page: 1, totalPages: 2 })).toBe(true);
    expect(wzPagerCanNext({ ...p, page: 2, totalPages: 2 })).toBe(false);
  });

  it("follows the cursor when nothing was counted, or the count is a floor", () => {
    expect(wzPagerCanNext({ ...p, totalPages: undefined })).toBe(true);
    expect(wzPagerCanNext({ ...p, totalPages: 1, totalPagesIsFloor: true })).toBe(true);
    expect(wzPagerCanNext({ ...p, totalPages: undefined, canNext: false })).toBe(false);
  });

  it("waits while the next page is on its way", () => {
    expect(wzPagerCanNext({ ...p, totalPages: 5, isFetching: true })).toBe(false);
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

  // Other lists (calls, invoices, transfers) page past counts that understate
  // their pages: the footer follows `canNext` as the list gives it.
  it("follows canNext as given", () => {
    render(<WzPager pager={{ ...base, page: 1, totalPages: 1, canNext: true }} />);
    expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled();
  });

  // list_07_bottom / uikit_wz_est_scroll1: the discs sit at 781 and 989 on
  // the 200–1600 column for "Page 1 of 5" and "Page 1 of 881" alike — a
  // 238px block centred on the bar, the words centred between the discs.
  it("centres ‹ Page › in Workiz's fixed 238px block, so the discs stay put whatever the count", () => {
    render(<WzPager pager={base} />);
    const block = screen.getByText("Page 1 of 5").parentElement!;
    expect(block.className).toContain("w-[238px]");
    expect(block.className).toContain("justify-between");
    expect(block.className).not.toContain("gap-[50px]");
    expect(screen.getByText("Page 1 of 5").className).not.toContain("min-w-[6.5rem]");
  });

  it("puts whatever it is given at the right end (the page size)", () => {
    render(<WzPager pager={base} end={<span>Rows</span>} />);
    expect(screen.getByText("Rows")).toBeInTheDocument();
  });

  // react-table prints its numbers raw: "Showing 1 to 10 of 4392 results",
  // "Page 1 of 440" (rep_activity_wz_06, and every Workiz capture since) —
  // so does the footer, on every list, without being asked (app_audit #9:
  // Contacts printed "4,641" beside reports printing "3103").
  it("prints the counts without thousands separators, as Workiz, by default", () => {
    render(<WzPager pager={{ ...base, to: 10, total: 4392, totalPages: 440, page: 1 }} />);
    expect(screen.getByText("Showing 1 to 10 of 4392 results")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 440")).toBeInTheDocument();
  });

  it("groups them only for a list that asks (`plainNumbers={false}`)", () => {
    render(<WzPager pager={{ ...base, to: 10, total: 4392, totalPages: 440, page: 1 }} plainNumbers={false} />);
    expect(screen.getByText("Showing 1 to 10 of 4,392 results")).toBeInTheDocument();
  });
});
