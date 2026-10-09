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
  it("is Workiz's 200px (app_audit_wz_home: sideMenu 200 + its 1px rule)", () => {
    // The stock shadcn 16rem eats a column of the jobs grid; and every page
    // was measured against Workiz from x=200.
    expect(widthOf("SIDEBAR_WIDTH")).toBe("12.5rem");
  });

  it("keeps the collapsed icon rail as it was", () => {
    expect(widthOf("SIDEBAR_WIDTH_ICON")).toBe("3rem");
  });
});
