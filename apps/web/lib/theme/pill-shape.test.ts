import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Workiz has no oval labels. A chip with text in it is a near-square
 * `rounded-chip`; `rounded-full` is reserved for things that are actually
 * circles — avatars, status dots, spinners, the New Job plus.
 *
 * The tell is horizontal padding: a circle is sized (`size-8`), a pill is
 * padded (`px-2`). So a bare `rounded-full` on a padded element is the thing
 * this guards against.
 */

const ROOT = join(__dirname, "..", "..");
const DIRS = ["app", "components", "features"];

function sources(): string[] {
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
  for (const dir of DIRS) walk(join(ROOT, dir));
  return out;
}

/** `rounded-full` on its own — not `hover:rounded-full`, which is deliberate. */
const BARE_ROUNDED_FULL = /(?<![\w:-])rounded-full/;
const HAS_X_PADDING = /(?<![\w-])(?:px|pl|pr)-[0-9.]+/;
/** A fixed square is a circle, however it is padded. */
const IS_SIZED_CIRCLE = /(?<![\w-])size-[0-9.]+/;

describe("no oval labels", () => {
  it("finds no padded rounded-full anywhere in the app", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!BARE_ROUNDED_FULL.test(line)) return;
        if (!HAS_X_PADDING.test(line)) return;
        if (IS_SIZED_CIRCLE.test(line)) return;
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("still allows the circles that should stay round", () => {
    // Sanity: the rule must not be so broad that it bans real circles.
    const avatar = 'className="grid size-6 place-items-center rounded-full bg-primary px-1"';
    const dot = 'className="size-1.5 rounded-full bg-destructive"';
    const hoverOval = 'className="px-2 hover:rounded-full"';
    for (const sample of [avatar, dot, hoverOval]) {
      const flagged =
        BARE_ROUNDED_FULL.test(sample) &&
        HAS_X_PADDING.test(sample) &&
        !IS_SIZED_CIRCLE.test(sample);
      expect(flagged, sample).toBe(false);
    }
  });
});
