import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Workiz renders every screen in Poppins (400 body, 500 headings and tabs,
// 600 buttons and the page title) with 0.4px of tracking on everything.
// Measured off app.workiz.com with getComputedStyle on 2026-10-08.
const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("the app font is Workiz's", () => {
  it("loads Poppins as the sans font, in the weights Workiz uses", () => {
    expect(layout).toMatch(/import\s*\{[^}]*\bPoppins\b[^}]*\}\s*from\s*"next\/font\/google"/);
    const call = layout.match(/Poppins\(\{([\s\S]*?)\}\)/);
    expect(call, "Poppins({...}) call").not.toBeNull();
    expect(call![1]).toContain('variable: "--font-sans"');
    for (const w of ["400", "500", "600"]) expect(call![1]).toContain(`"${w}"`);
  });

  it("no longer loads Geist as the sans font", () => {
    expect(layout).not.toMatch(/\bGeist\(/);
  });

  it("tracks text by 0.4px like Workiz", () => {
    const html = css.match(/\n\s*html\s*\{([\s\S]*?)\}/);
    expect(html, "html {} rule").not.toBeNull();
    expect(html![1]).toMatch(/letter-spacing:\s*0\.4px/);
  });
});
