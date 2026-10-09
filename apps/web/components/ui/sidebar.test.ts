import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "sidebar.tsx"), "utf8");

function widthOf(constant: string): string {
  const m = source.match(new RegExp(`const ${constant} = "([^"]+)"`));
  if (!m) throw new Error(`${constant} not found`);
  return m[1];
}

describe("the sidebar rail", () => {
  it("is narrower than the stock shadcn 16rem", () => {
    // Workiz runs a tight rail; 16rem eats a column of the jobs grid.
    const rem = parseFloat(widthOf("SIDEBAR_WIDTH"));
    expect(rem).toBeLessThan(16);
    expect(rem).toBeGreaterThanOrEqual(11);
  });

  it("keeps the collapsed icon rail as it was", () => {
    expect(widthOf("SIDEBAR_WIDTH_ICON")).toBe("3rem");
  });
});
