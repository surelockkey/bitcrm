import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DAY_END, DAY_START, toIsoInstant, toLocalParts, type DateTimeRange } from "@/lib/date-range";
import { DateTimeRangePicker } from "./date-time-range-picker";

/** Controlled wrapper — the picker only ever renders the range it's given. */
function Harness({
  initial = {},
  onChange,
}: {
  initial?: DateTimeRange;
  onChange?: (r: DateTimeRange) => void;
}) {
  const [range, setRange] = useState<DateTimeRange>(initial);
  return (
    <DateTimeRangePicker
      value={range}
      onChange={(r) => {
        setRange(r);
        onChange?.(r);
      }}
    />
  );
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "Date & time" }));

/** The visible month grid (the trigger and presets are buttons too). */
const dayButton = (day: string) =>
  screen
    .getAllByRole("button", { name: day })
    .find((b) => b.classList.contains("size-8"))!;

describe("DateTimeRangePicker", () => {
  it("starts empty and closed", () => {
    render(<Harness />);
    expect(screen.getByText("Any date")).toBeInTheDocument();
    expect(screen.queryByText("Start time")).not.toBeInTheDocument();
  });

  it("builds a whole-day range from two clicks", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Anchor the calendar on a known month.
    render(
      <Harness
        initial={{ from: toIsoInstant("2026-08-01", DAY_START) }}
        onChange={onChange}
      />,
    );
    await open(user);

    await user.click(dayButton("14"));
    const last = () => onChange.mock.lastCall![0] as DateTimeRange;
    expect(toLocalParts(last().to)).toEqual({ date: "2026-08-14", time: DAY_END });
    expect(toLocalParts(last().from)).toEqual({ date: "2026-08-01", time: DAY_START });
    expect(screen.getByText("Aug 1 – Aug 14")).toBeInTheDocument();
  });

  it("restarts the range when the second click lands before the start", async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ from: toIsoInstant("2026-08-10", DAY_START) }} />);
    await open(user);

    await user.click(dayButton("3"));
    expect(screen.getByText("From Aug 3")).toBeInTheDocument();
  });

  const singleDay = {
    from: toIsoInstant("2026-08-05", DAY_START),
    to: toIsoInstant("2026-08-05", DAY_END),
  };

  it("narrows an existing range to a typed time of day", async () => {
    const user = userEvent.setup();
    render(<Harness initial={singleDay} />);
    await open(user);

    // Off-list minutes are reachable only by typing.
    const start = screen.getByRole("combobox", { name: "Start time" });
    await user.clear(start);
    await user.type(start, "9:07am{Enter}");
    const end = screen.getByRole("combobox", { name: "End time" });
    await user.clear(end);
    await user.type(end, "1715{Enter}");

    expect(screen.getByText("Aug 5 · 9:07 AM – 5:15 PM")).toBeInTheDocument();
  });

  it("commits a typed time on blur", async () => {
    const user = userEvent.setup();
    render(<Harness initial={singleDay} />);
    await open(user);

    const start = screen.getByRole("combobox", { name: "Start time" });
    await user.clear(start);
    await user.type(start, "10");
    await user.tab();

    expect(screen.getByText(/10:00 AM/)).toBeInTheDocument();
  });

  it("flags unparseable input and falls back to the current time", async () => {
    const user = userEvent.setup();
    render(<Harness initial={singleDay} />);
    await open(user);

    const start = screen.getByRole("combobox", { name: "Start time" });
    await user.clear(start);
    await user.type(start, "half nine");
    expect(start).toHaveAttribute("aria-invalid", "true");

    await user.tab();
    expect(start).toHaveValue("12:00 AM");
    expect(start).not.toHaveAttribute("aria-invalid");
  });

  it("still offers the quarter-hour list to pick from", async () => {
    const user = userEvent.setup();
    render(<Harness initial={singleDay} />);
    await open(user);

    const start = screen.getByRole("combobox", { name: "Start time" });
    await user.click(start);
    await user.type(start, "9:3");
    await user.click(
      within(screen.getByRole("listbox", { name: "Start time suggestions" }))
        .getByRole("option", { name: "9:30 AM" }),
    );

    expect(start).toHaveValue("9:30 AM");
  });

  it("dateOnly mode: one calendar range, no time fields", async () => {
    const user = userEvent.setup();
    const seen: DateTimeRange[] = [];
    function DateOnlyHarness() {
      const [range, setRange] = useState<DateTimeRange>({});
      return (
        <DateTimeRangePicker
          value={range}
          onChange={(r) => {
            setRange(r);
            seen.push(r);
          }}
          dateOnly
          label="Days"
        />
      );
    }
    render(<DateOnlyHarness />);

    await user.click(screen.getByRole("button", { name: "Days" }));
    expect(screen.queryByRole("combobox", { name: "Start time" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "End time" })).not.toBeInTheDocument();

    await user.click(dayButton("5"));
    await user.click(dayButton("8"));
    expect(seen.at(-1)?.from).toContain("T");
    expect(seen.at(-1)?.to).toContain("T");
  });

  it("applies presets and clears back to any date", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await open(user);

    await user.click(screen.getByRole("button", { name: "Today" }));
    const applied = onChange.mock.lastCall![0] as DateTimeRange;
    expect(toLocalParts(applied.from)?.time).toBe(DAY_START);
    expect(toLocalParts(applied.to)?.time).toBe(DAY_END);

    await user.click(screen.getByRole("button", { name: "Clear date filter" }));
    expect(screen.getByText("Any date")).toBeInTheDocument();
  });

  it("slides back on screen when it would overflow the viewport", async () => {
    const user = userEvent.setup();
    // A panel hanging 248px past the right edge of a 1000px viewport.
    const rect = {
      left: 600, right: 1240, top: 100, bottom: 700,
      width: 640, height: 600, x: 600, y: 100,
      toJSON: () => ({}),
    } as DOMRect;
    const spy = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue(rect);
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });

    render(<Harness />);
    await open(user);

    const panel = document.querySelector<HTMLElement>(
      '[data-slot="date-range-panel"]',
    )!;
    expect(panel.style.transform).toBe("translateX(-248px)");

    spy.mockRestore();
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await open(user);
    expect(screen.getByText("Start time")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByText("Start time")).not.toBeInTheDocument();
  });
});
