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
  it("rules every column but the last", () => {
    const container = grid();
    const cells = [
      ...container.querySelectorAll("thead th"),
      ...container.querySelectorAll("tbody td"),
    ];
    expect(cells).toHaveLength(12);
    for (const cell of cells) {
      expect(cell.className).toContain("border-r");
      expect(cell.className).toContain("border-table-border");
      expect(cell.className).toContain("last:border-r-0");
    }
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
