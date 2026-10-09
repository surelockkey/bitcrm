import { describe, expect, it } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import { TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";
import { fitColumnWidths, WzScrollGrid } from "./scroll-grid";

/**
 * Workiz's call grid at two widths (callspage_wz_01 at 1600×1000, the
 * 2026-10-09 probe at 1440×800): react-table gives each column a minimum
 * and lets the ones without a set width grow in proportion to it — Status,
 * From, Call Flow and Answered By keep their width, the rest share what is
 * left of the page.
 */
const WZ_CALLS = [
  { id: "status", width: 70, fixed: true },
  { id: "from", width: 160, fixed: true },
  { id: "to", width: 100 },
  { id: "time", width: 120 },
  { id: "flow", width: 180, fixed: true },
  { id: "source", width: 100 },
  { id: "tags", width: 135 },
  { id: "answeredBy", width: 180, fixed: true },
  { id: "job", width: 100 },
  { id: "revenue", width: 100 },
];
const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe("fitColumnWidths", () => {
  it("grows the growing columns in proportion to their minimum, to the page's width (1600: 1398px)", () => {
    const fit = fitColumnWidths(WZ_CALLS, 1398);
    // 153px over the 655px of growing minimums: 23.36% each.
    expect(fit.status).toBe(70);
    expect(fit.from).toBe(160);
    expect(fit.flow).toBe(180);
    expect(fit.answeredBy).toBe(180);
    expect(fit.to).toBeCloseTo(123.36, 1);
    expect(fit.time).toBeCloseTo(148.03, 1);
    expect(fit.tags).toBeCloseTo(166.53, 1);
    expect(fit.revenue).toBeCloseTo(123.36, 1);
    expect(sum(fit)).toBeCloseTo(1398, 6);
  });

  it("keeps every minimum when the page is narrower than their sum (1440: 1238px for 1245px of columns)", () => {
    expect(fitColumnWidths(WZ_CALLS, 1238)).toEqual(Object.fromEntries(WZ_CALLS.map((c) => [c.id, c.width])));
  });

  it("keeps the minimums while the page is unmeasured", () => {
    expect(fitColumnWidths(WZ_CALLS, 0)).toEqual(Object.fromEntries(WZ_CALLS.map((c) => [c.id, c.width])));
  });

  it("gives nothing to a column the reader has sized (fixed), the rest share it", () => {
    const resized = WZ_CALLS.map((c) => (c.id === "to" ? { ...c, width: 300, fixed: true } : c));
    const fit = fitColumnWidths(resized, 1600);
    expect(fit.to).toBe(300);
    expect(sum(fit)).toBeCloseTo(1600, 6);
    expect(fit.time).toBeGreaterThan(120);
  });

  it("shares the width among every column when none is marked fixed", () => {
    const fit = fitColumnWidths(
      [
        { id: "a", width: 100 },
        { id: "b", width: 300 },
      ],
      800,
    );
    expect(fit).toEqual({ a: 200, b: 600 });
  });

  it("leaves a table of only fixed columns at their widths", () => {
    const fit = fitColumnWidths(
      [
        { id: "a", width: 100, fixed: true },
        { id: "b", width: 300, fixed: true },
      ],
      800,
    );
    expect(fit).toEqual({ a: 100, b: 300 });
  });
});

const COLUMNS = [
  { id: "a", label: "Alpha", width: 100 },
  { id: "b", label: "Beta", width: 200 },
];

function Grid(props: Partial<React.ComponentProps<typeof WzScrollGrid>> = {}) {
  return (
    <WzScrollGrid
      columns={COLUMNS}
      header={(widthOf) => COLUMNS.map((c) => <TableHead key={c.id}>{`${c.label} ${widthOf(c.id)}`}</TableHead>)}
      {...props}
    >
      <TableBody>
        <TableRow>
          <TableCell>one</TableCell>
          <TableCell>two</TableCell>
        </TableRow>
      </TableBody>
    </WzScrollGrid>
  );
}

/**
 * Workiz's grid scrolls sideways inside its own box while the page scrolls
 * only up and down (the 1280/1440 probes, 2026-10-09: `html` has no sideways
 * scroll, the rows' box does), and its header stays pinned to the top of
 * the page and moves sideways with the rows (callspage_wz_02_scroll1, the
 * 1280 scrolled probe). The header is one table, the rows another, the same
 * columns in both; the rows' box is the only sideways scroller.
 */
describe("WzScrollGrid", () => {
  it("pins the header to the page's top and scrolls the rows sideways in their own box", () => {
    const { container } = render(<Grid />);
    const head = container.querySelector("[data-slot=wz-scroll-grid-head]") as HTMLElement;
    const body = container.querySelector("[data-slot=wz-scroll-grid-body]") as HTMLElement;
    expect(head.className).toMatch(/\bsticky\b/);
    expect(head.className).toMatch(/\btop-0\b/);
    expect(head.className).toMatch(/\boverflow-hidden\b/);
    expect(body.className).toMatch(/\boverflow-x-auto\b/);
    // The frame itself never scrolls: one sideways scroller, the rows' box.
    expect((container.firstElementChild as HTMLElement).className).not.toMatch(/overflow-(x-)?auto/);
  });

  it("lays the header and the rows out on the same columns", () => {
    const { container } = render(<Grid />);
    const widths = (slot: string) =>
      [...container.querySelectorAll(`[data-slot=${slot}] colgroup col`)].map((c) => (c as HTMLElement).style.width);
    expect(widths("wz-scroll-grid-head")).toEqual(["100px", "200px"]);
    expect(widths("wz-scroll-grid-body")).toEqual(widths("wz-scroll-grid-head"));
    for (const table of container.querySelectorAll("table")) expect(table.className).toContain("table-fixed");
  });

  it("moves the header sideways with the rows", () => {
    const { container } = render(<Grid />);
    const head = container.querySelector("[data-slot=wz-scroll-grid-head]") as HTMLElement;
    const body = container.querySelector("[data-slot=wz-scroll-grid-body]") as HTMLElement;
    body.scrollLeft = 120;
    fireEvent.scroll(body);
    expect(head.scrollLeft).toBe(120);
  });

  it("tells a screen reader the rows' columns too, without a second visible header", () => {
    const { container } = render(<Grid />);
    const body = container.querySelector("[data-slot=wz-scroll-grid-body]") as HTMLElement;
    const heads = within(body).getAllByRole("columnheader");
    expect(heads.map((h) => h.textContent)).toEqual(["Alpha", "Beta"]);
    expect(heads[0].closest("thead")?.className).toContain("sr-only");
  });

  it("hands the header the widths the columns are drawn at", () => {
    const { container } = render(<Grid />);
    const head = container.querySelector("[data-slot=wz-scroll-grid-head]") as HTMLElement;
    expect(within(head).getByText("Alpha 100")).toBeInTheDocument();
    expect(within(head).getByText("Beta 200")).toBeInTheDocument();
  });

  it("is a frame with Workiz's 1px rule, busy while told so", () => {
    const { container } = render(<Grid busy />);
    const frame = container.firstElementChild as HTMLElement;
    expect(frame.className).toContain("border-wz-frame");
    expect(frame.getAttribute("aria-busy")).toBe("true");
  });

  it("draws what is handed as `after` over the rows (an empty wash, a dialog)", () => {
    const { getByText } = render(<Grid after={<div>No Calls Found</div>} />);
    expect(getByText("No Calls Found")).toBeInTheDocument();
  });
});
