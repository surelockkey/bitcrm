/**
 * Workiz's pill buttons on the job page, measured on job_b_01_details /
 * job_b_tab_items: 34px tall (40px for the Estimates tab's), 13px/600 ink
 * with 0.2px tracking, 12px side padding plus the 4px around the label.
 * Yellow is the `primary` token (#fad400); hover darkens it to #eac300
 * (jobshell_wz_createinvoice_hover). The outline is a 1px ink border that
 * hovers to the top bar's #f3f6f7 (jobshell_wz_actions_hover).
 */
const PILL =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-pill text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

export const PILL_YELLOW = `${PILL} h-[34px] bg-primary px-4 hover:bg-[#eac300]`;
export const PILL_OUTLINE = `${PILL} h-[34px] border border-foreground bg-transparent px-4 hover:bg-topbar aria-expanded:bg-topbar`;
/** The taller outline pills of the Estimates tab (40px, 24px sides). */
export const PILL_OUTLINE_TALL = `${PILL} h-10 border border-foreground bg-transparent px-6 hover:bg-topbar`;
/** "Add payment" / "Upload" / "Add New": 32px yellow. */
export const PILL_YELLOW_SM = `${PILL} h-8 bg-primary px-4 hover:bg-[#eac300]`;
