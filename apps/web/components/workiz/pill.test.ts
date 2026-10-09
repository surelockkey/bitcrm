import { describe, expect, it } from "vitest";

import { wzPill } from "./pill";

/**
 * The job page drew its own Workiz pills (features/deals/components/
 * job-pills.ts) until the kit took them over (2026-10-09). These are the
 * classes it measured on job_b_01_details / job_b_tab_items: 34px, 13px/600
 * ink with 0.2px tracking, 16px sides; yellow #fad400 hovering to #eac300, or
 * a 1px ink edge hovering to the top bar's #f3f6f7.
 */
describe("wzPill", () => {
  it("is the job page's 34px pill, yellow or outlined", () => {
    const yellow = wzPill("yellow").split(/\s+/);
    expect(yellow).toEqual(
      expect.arrayContaining(["h-[34px]", "px-4", "bg-primary", "hover:bg-[#eac300]", "text-[13px]", "font-semibold", "tracking-[0.2px]", "text-foreground"]),
    );
    const outline = wzPill("outline").split(/\s+/);
    expect(outline).toEqual(
      expect.arrayContaining(["h-[34px]", "px-4", "border", "border-foreground", "bg-transparent", "hover:bg-topbar", "aria-expanded:bg-topbar"]),
    );
  });

  it("grows to 40px with 24px sides for the Estimates tab, and shrinks to 32px for Add payment / Upload", () => {
    expect(wzPill("outline", "tall").split(/\s+/)).toEqual(expect.arrayContaining(["h-10", "px-6", "border-foreground"]));
    expect(wzPill("yellow", "small").split(/\s+/)).toEqual(expect.arrayContaining(["h-8", "px-4", "bg-primary"]));
  });

  it("is always a pill, never a padded rounded-full", () => {
    for (const cls of [wzPill("yellow"), wzPill("outline"), wzPill("outline", "tall"), wzPill("yellow", "small")]) {
      expect(cls).toContain("rounded-pill");
      expect(cls).not.toMatch(/(?<![\w:-])rounded-full/);
    }
  });
});
