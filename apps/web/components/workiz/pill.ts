/**
 * Workiz's pill buttons as plain classes, for the places that draw a pill on
 * an element of their own (a menu trigger, a link) rather than a `<Button>`.
 * Measured on job_b_01_details / job_b_tab_items: 34px tall (40px for the
 * Estimates tab's outline pills, 32px for "Add payment" / "Upload"),
 * 13px/600 ink with 0.2px tracking, 16px sides. Yellow is the `primary`
 * token (#fad400), #eac300 hovered (jobshell_wz_createinvoice_hover); the
 * outline is a 1px ink edge that hovers to #f3f6f7 (jobshell_wz_actions_hover).
 *
 * `<Button>` (components/ui) is the same look with Workiz's own heights
 * (32 / 26 / 40px); use these only where the job page's 34px pill is wanted.
 * Identical to features/deals/components/job-pills.ts, which can re-export
 * them (pill.test.ts holds the two together).
 */
const PILL =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

const PILLS = {
  yellow: {
    regular: `${PILL} h-[34px] bg-primary px-4 hover:bg-[#eac300]`,
    small: `${PILL} h-8 bg-primary px-4 hover:bg-[#eac300]`,
    tall: `${PILL} h-10 bg-primary px-6 hover:bg-[#eac300]`,
  },
  outline: {
    regular: `${PILL} h-[34px] border border-foreground bg-transparent px-4 hover:bg-topbar aria-expanded:bg-topbar`,
    small: `${PILL} h-8 border border-foreground bg-transparent px-4 hover:bg-topbar aria-expanded:bg-topbar`,
    tall: `${PILL} h-10 border border-foreground bg-transparent px-6 hover:bg-topbar`,
  },
} as const;

export type WzPillTone = keyof typeof PILLS;
export type WzPillSize = keyof (typeof PILLS)["yellow"];

/** `wzPill("yellow")` → the 34px Create Invoice pill; `wzPill("outline", "tall")` → "+ Add Estimate". */
export function wzPill(tone: WzPillTone, size: WzPillSize = "regular"): string {
  return PILLS[tone][size];
}
