import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

/**
 * The Workiz grid, sampled from their jobs screenshot: a #cfcfcf rule between
 * every column, a grey header strip, alternating rows and square corners.
 * It lives in the primitive because it is how every table in the app looks,
 * not just the jobs one.
 */
function grid() {
  return render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Job #</TableHead>
          <TableHead>Client</TableHead>
          <TableHead>City</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {["a", "b", "c"].map((id) => (
          <TableRow key={id}>
            <TableCell>{id}</TableCell>
            <TableCell>Jane</TableCell>
            <TableCell>Dallas</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>,
  ).container;
}

describe("the table grid", () => {
  it("rules every column but the last: solid #ccc in the header, dotted #cfcfcf below", () => {
    // react-table as Workiz skins it: `.rt-th` 1px solid #ccc, `.rt-td`
    // 1px dotted #cfcfcf, the last column unruled.
    const container = grid();
    const heads = [...container.querySelectorAll("thead th")];
    const cells = [...container.querySelectorAll("tbody td")];
    expect(heads).toHaveLength(3);
    expect(cells).toHaveLength(9);
    for (const head of heads) {
      expect(head.className).toContain("border-r");
      expect(head.className).toContain("border-input");
      expect(head.className).toContain("last:border-r-0");
    }
    for (const cell of cells) {
      expect(cell.className).toContain("border-r");
      expect(cell.className).toContain("border-dotted");
      expect(cell.className).toContain("border-table-border");
      expect(cell.className).toContain("last:border-r-0");
    }
  });

  it("sizes the header and the cells the Workiz way", () => {
    // uikit_wz_estimates: th 41px, 14px/500 #404040, 10px in; td 20px all
    // round, 14px/16px #404040 (centred: our rows mix avatars and chips).
    const container = grid();
    const head = container.querySelector("thead th")!.className.split(/\s+/);
    expect(head).toEqual(expect.arrayContaining(["h-[41px]", "px-2.5", "font-medium", "text-wz-strong"]));
    const cell = container.querySelector("tbody td")!.className.split(/\s+/);
    expect(cell).toEqual(expect.arrayContaining(["p-5", "leading-4", "align-middle", "text-wz-strong"]));
  });

  it("darkens a row under the cursor, over the zebra too (but not a filler row)", () => {
    const row = grid().querySelector("tbody tr")!;
    expect(row.className).toContain("hover:bg-black/5");
    // Beats the zebra's `tbody > tr:nth-child(odd)`; `aria-hidden` filler
    // rows (react-table's -padRow) stay still, as Workiz's do.
    expect(row.className).toContain("odd:not-aria-hidden:hover:bg-black/5");
  });

  it("never hovers the header row", () => {
    const head = grid().querySelector("thead tr")!;
    expect(head.className).not.toContain("hover:bg-black/5");
  });

  it("sits the header on the grey strip", () => {
    expect(grid().querySelector("thead")?.className).toMatch(
      /(^|\s)bg-muted(\s|$)/,
    );
  });

  it("greys every other body row", () => {
    expect(grid().querySelector("tbody")?.className).toContain(
      "[&>tr:nth-child(odd)]:bg-muted",
    );
  });

  it("keeps its corners square", () => {
    const wrapper = grid().querySelector("[data-slot='table-container']");
    expect(wrapper?.className).not.toMatch(/rounded-(sm|md|lg|xl|2xl|3xl|full)/);
  });
});

describe("a sorted column", () => {
  it.each([
    ["asc", "ascending", "shadow-[inset_0_3px_0_0_rgba(0,0,0,0.6)]"],
    ["desc", "descending", "shadow-[inset_0_-3px_0_0_rgba(0,0,0,0.6)]"],
  ] as const)("draws react-table's 3px bar for %s and says so", (sort, aria, bar) => {
    const { container } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sort={sort}>Created</TableHead>
            <TableHead>Amount</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    const [sorted, plain] = [...container.querySelectorAll("th")];
    expect(sorted.getAttribute("aria-sort")).toBe(aria);
    expect(sorted.className).toContain(bar);
    expect(plain.hasAttribute("aria-sort")).toBe(false);
    expect(plain.className).not.toContain("inset_0");
  });
});

describe("a fixed-layout table", () => {
  it("keeps narrow sides (the header's 10px) for its declared column widths, with Workiz's 20px rhythm", () => {
    const { container } = render(
      <Table className="table-fixed">
        <TableBody>
          <TableRow>
            <TableCell>$748.00</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = container.querySelector("td")!.className.split(/\s+/);
    expect(cell).toEqual(expect.arrayContaining(["px-2.5", "py-5"]));
    expect(cell).not.toContain("p-5");
  });
});

describe("a compact table", () => {
  it("packs its cells for dialogs and side panels", () => {
    const { container } = render(
      <Table density="compact">
        <TableBody>
          <TableRow>
            <TableCell>a</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = container.querySelector("td")!.className.split(/\s+/);
    expect(cell).toEqual(expect.arrayContaining(["px-3", "py-2", "align-middle"]));
    expect(cell).not.toContain("p-5");
    expect(container.querySelector("table")?.getAttribute("data-density")).toBe("compact");
  });

  it("is what a table inside a dialog gets unless it asks otherwise", async () => {
    const { Dialog, DialogContent, DialogTitle } = await import("./dialog");
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Stock</DialogTitle>
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>a</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>,
    );
    expect(document.querySelector("table")?.getAttribute("data-density")).toBe("compact");
  });
});

/** Every `.tsx` under the given roots. */
function sources(roots: string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return out;
}

/**
 * A table inside a frame that already scrolls sideways (the inventory lists)
 * leaves the scrolling to the frame: two nested scrollers meant the inner one
 * scrolled and would clip anything drawn in a cell that isn't portalled.
 */
describe("a table in a frame of its own", () => {
  it("keeps its own sideways scroller by default", () => {
    const { container } = render(<Table><tbody /></Table>);
    expect(container.querySelector("[data-slot=table-container]")).not.toBeNull();
  });

  it("drops it when the frame around it scrolls", () => {
    const { container } = render(
      <div data-testid="frame" className="overflow-x-auto">
        <Table contained={false}><tbody /></Table>
      </div>,
    );
    expect(container.querySelector("[data-slot=table-container]")).toBeNull();
    expect(container.querySelector("table")?.parentElement?.className).toBe("overflow-x-auto");
  });
});

describe("no table is wrapped in rounded corners", () => {
  it("finds no rounded scroll wrapper in any feature", () => {
    const root = join(__dirname, "..", "..");
    const offenders: string[] = [];
    for (const file of sources([join(root, "features"), join(root, "app")])) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("<Table")) continue;
      for (const line of text.split("\n")) {
        const wrapsATable =
          line.includes("overflow-x-auto") || line.includes("overflow-hidden");
        if (wrapsATable && /rounded-(md|lg|xl|2xl|3xl)/.test(line)) {
          offenders.push(`${file.slice(root.length + 1)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
