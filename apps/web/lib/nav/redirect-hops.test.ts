import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isRedirectHop } from "./page-history";

/**
 * Every route under `app/(app)` whose page does nothing but `redirect()` is
 * a hop, and a hop must not leave a crumb in the strip. This walks the app
 * tree so a redirect page added later cannot bring "PAYMENTS # PAYMENTS"
 * back without failing here.
 */
const APP = join(__dirname, "..", "..", "app", "(app)");
const ID = "0199c4d2-7b1e-4f7a-9c3d-abcdef123456";

function pages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pages(full));
    else if (name === "page.tsx") out.push(full);
  }
  return out;
}

/** "/inventory/warehouses/[id]" → "/inventory/warehouses/<uuid>" */
function routeOf(file: string): string {
  const dir = relative(APP, join(file, ".."));
  return "/" + dir.split("/").filter(Boolean).map((seg) => (seg.startsWith("[") ? ID : seg)).join("/");
}

function redirectsOnly(source: string): boolean {
  return /from "next\/navigation"/.test(source) && /\bredirect\(/.test(source) && !/return\s*\(?\s*</.test(source);
}

describe("redirect-only pages", () => {
  const hops = pages(APP).filter((f) => redirectsOnly(readFileSync(f, "utf8"))).map(routeOf);

  it("exist (the scan finds the known hops)", () => {
    expect(hops).toEqual(expect.arrayContaining(["/payments", "/price-book", "/inventory", "/settings/general"]));
  });

  it.each(pages(APP).filter((f) => redirectsOnly(readFileSync(f, "utf8"))).map(routeOf))("%s leaves no crumb", (route) => {
    expect(isRedirectHop(route)).toBe(true);
  });
});
