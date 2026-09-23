import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DARK, LIGHT, type TokenName } from "@/lib/theme/tokens";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** `mutedForeground` -> `muted-foreground` */
function cssName(token: string): string {
  return token.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

function block(selector: string): string {
  // Matches `:root {` / `.dark {` up to the first closing brace at line start.
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
  const found = css.match(re);
  if (!found) throw new Error(`No ${selector} block in globals.css`);
  return found[1];
}

function declared(selector: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of block(selector).split("\n")) {
    const m = line.match(/^\s*--([a-z0-9-]+):\s*([^;]+);/);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

describe("globals.css is generated from lib/theme/tokens", () => {
  const light = declared(":root");
  const dark = declared("\\.dark");
  const names = Object.keys(LIGHT) as TokenName[];

  it("has a token for every name, in both blocks", () => {
    for (const name of names) {
      expect(light.has(cssName(name)), `:root --${cssName(name)}`).toBe(true);
      expect(dark.has(cssName(name)), `.dark --${cssName(name)}`).toBe(true);
    }
  });

  it("carries the exact light values", () => {
    for (const name of names) {
      expect(light.get(cssName(name)), `--${cssName(name)}`).toBe(LIGHT[name]);
    }
  });

  it("carries the exact dark values", () => {
    for (const name of names) {
      expect(dark.get(cssName(name)), `--${cssName(name)}`).toBe(DARK[name]);
    }
  });

  it("exposes every token to Tailwind as a --color-* utility", () => {
    const theme = block("@theme inline");
    for (const name of names) {
      const declaration = `--color-${cssName(name)}: var(--${cssName(name)});`;
      expect(theme, declaration).toContain(declaration);
    }
  });

  it("no longer carries the stock shadcn oklch palette", () => {
    expect(block(":root")).not.toContain("oklch");
    expect(block("\\.dark")).not.toContain("oklch");
  });
});
