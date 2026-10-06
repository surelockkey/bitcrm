import { describe, it, expect, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ESTIMATE_DATE_PRESETS } from "../lib";
import { DateRangeControl, useReportRange } from "./report-bits";

/**
 * The period picker of the billing lists (Estimates, Invoices, Tax).
 *
 * It was a bare browser select with the same words echoed in small grey text
 * beside it. Now it is the app's date control: one button with a calendar,
 * the period and its days on it, opening a list of periods — and, for Custom,
 * the two days, in the same panel.
 */
function setup(initial: Parameters<typeof useReportRange>[0] = "all_time") {
  const hook = renderHook(() => useReportRange(initial));
  const view = render(<DateRangeControl presets={ESTIMATE_DATE_PRESETS} state={hook.result.current} />);
  const rerender = () => view.rerender(<DateRangeControl presets={ESTIMATE_DATE_PRESETS} state={hook.result.current} />);
  return { hook, rerender };
}

const trigger = () => screen.getByRole("button", { name: /date range/i });

describe("DateRangeControl", () => {
  it("is one button that names the period — no select, no echo beside it", () => {
    setup("all_time");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(trigger()).toHaveTextContent("All time");
    expect(screen.getAllByText("All time")).toHaveLength(1);
  });

  it("shows a bounded period's days on the button", () => {
    const { hook } = setup("today");
    const { from } = hook.result.current.range;
    const day = new Date(`${from}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    expect(trigger()).toHaveTextContent("Today");
    expect(trigger()).toHaveTextContent(day);
  });

  it("opens the periods; picking one sets it and closes the list", async () => {
    const u = userEvent.setup();
    const { hook, rerender } = setup("all_time");
    await u.click(trigger());
    expect(trigger()).toHaveAttribute("aria-expanded", "true");

    await u.click(screen.getByRole("button", { name: "Last month" }));
    rerender();

    expect(hook.result.current.preset).toBe("last_month");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "This month" })).toBeNull();
  });

  it("keeps the list open for Custom and takes the two days there", async () => {
    const u = userEvent.setup();
    const { hook, rerender } = setup("all_time");
    await u.click(trigger());
    await u.click(screen.getByRole("button", { name: "Custom" }));
    rerender();

    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    await act(async () => {
      await u.type(screen.getByLabelText("From"), "2026-09-01");
    });
    rerender();
    await act(async () => {
      await u.type(screen.getByLabelText("To"), "2026-09-15");
    });
    rerender();

    expect(hook.result.current.range).toEqual({ from: "2026-09-01", to: "2026-09-15" });
    expect(trigger()).toHaveTextContent(/Sep 1/);
    expect(trigger()).toHaveTextContent(/Sep 15/);
  });

  /** Workiz's list is long and All time sits near its end: open on the period in use. */
  it("opens scrolled to the period in use", async () => {
    const u = userEvent.setup();
    const scrolled: string[] = [];
    const spy = vi.fn(function (this: Element) {
      scrolled.push(this.textContent ?? "");
    });
    Element.prototype.scrollIntoView = spy as unknown as Element["scrollIntoView"];
    setup("all_time");
    await u.click(trigger());
    expect(scrolled).toContain("All time");
  });

  it("closes on Escape", async () => {
    const u = userEvent.setup();
    setup("all_time");
    await u.click(trigger());
    await u.keyboard("{Escape}");
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
  });
});
