import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WzCalendar } from "./calendar";

/**
 * 2026-10-12 owner rule: the web's today is Connecticut's. Staff sit in
 * Ukraine, where the browser's day turns over seven hours early.
 */
describe("WzCalendar — today", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rings Connecticut's today, not the browser's", () => {
    // 03:30 UTC on Oct 13 is Oct 12, 11:30 pm EDT (and 06:30 on the 13th in Kyiv).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-13T03:30:00.000Z"));
    render(<WzCalendar value="" onSelect={() => {}} />);
    const today = screen.getAllByRole("gridcell").find((c) => c.getAttribute("aria-current") === "date");
    expect(today?.getAttribute("data-iso")).toBe("2026-10-12");
    expect(screen.getByText("October 2026")).toBeInTheDocument();
  });
});
