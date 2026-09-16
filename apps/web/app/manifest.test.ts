import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// Whether the run starts in apps/web or at the repo root.
const publicDir = ["public", "apps/web/public"]
  .map((p) => path.join(process.cwd(), p))
  .find((p) => existsSync(p))!;

const icons = manifest().icons ?? [];

describe("web app manifest", () => {
  it("ships every icon it names", () => {
    expect(icons.length).toBeGreaterThan(0);
    for (const icon of icons) {
      expect(existsSync(path.join(publicDir, icon.src))).toBe(true);
    }
  });

  it("gives the maskable icon its own artwork, not the full-bleed one", () => {
    // A launcher crops a maskable icon to its own shape. Declaring the "any"
    // artwork maskable hands it a logo that already reaches the edges, so the
    // crop eats them; the maskable file carries its own safe zone.
    const maskable = icons.filter((i) => i.purpose === "maskable");
    const any = icons.filter((i) => i.purpose !== "maskable").map((i) => i.src);

    expect(maskable).toHaveLength(1);
    expect(any).not.toContain(maskable[0].src);
  });

  it("opens on the page that routes each role to their own landing", () => {
    expect(manifest().start_url).toBe("/");
    expect(manifest().display).toBe("standalone");
  });
});
