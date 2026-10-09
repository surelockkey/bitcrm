/**
 * Workiz's ui-components MenuPopup — the small white menu under the estimate
 * page's "Actions", "Send" and "Add estimate" (pg_estimate_wz_05_actions_open,
 * pg_estimate_wz_c05_actions_open; main.css `MenuPopup-module`). Not the job
 * page's 216px Actions panel with 50px slate rows (`DropdownMenuContent`'s
 * default, `WzActionsMenu`): this one is as wide as its longest row,
 *
 *   panel  white, 8px corners, 8px in, `0 0 4px rgba(59,75,82,.05),
 *          0 8px 16px rgba(59,75,82,.15)`, no rules between rows;
 *   row    35px: 8px 23px 8px 12px, 13px/19px ink with 0.4px tracking, a 24px
 *          slot for the 17px glyph, then the words; #f3f6f7 under the cursor.
 *          Delete stays ink (Workiz does not colour it).
 *
 * Pass them to `DropdownMenuContent` / `DropdownMenuItem` as `className`.
 * Workiz hangs the panel 8px under its button, right edges level within 4px:
 * `align="end" sideOffset={8} alignOffset={-4}`.
 */
export const WZ_MENU_POPUP =
  "w-max min-w-0 rounded-[8px] p-2 shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)] [&_[data-slot=dropdown-menu-item]+[data-slot=dropdown-menu-item]]:border-t-0";

export const WZ_MENU_POPUP_ITEM =
  "min-h-[35px] gap-0 rounded-[4px] py-2 pr-[23px] pl-3 text-[13px] leading-[19px] tracking-[0.4px] whitespace-nowrap text-foreground focus:bg-wz-secondary-hover focus:text-foreground data-[variant=destructive]:text-foreground data-[variant=destructive]:focus:text-foreground data-[variant=destructive]:*:[svg]:text-foreground [&_svg]:mx-[3.5px] [&_svg:not([class*='size-'])]:size-[17px]";
