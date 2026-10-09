import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Pieces of Workiz's document pages — the estimate (pg_estimate_wz_01_job,
 * pg_estimate_wz_02_client) and, by the same modules, the invoice: the
 * section heads under the totals and the totals' label + grey box rows.
 */

/**
 * A section's head ("Notes", "Signatures"; main.css `estimate-module__title`,
 * `signatures-module__title`): the glyph and an 18px/22px 500 #3b4c53 title on
 * the left, the section's button on the right, over a 1px rule. Workiz rules
 * Signatures / Attachments #cad3d6 with 6px under (the default) and Notes #ccc
 * with 15px — pass `className="border-input pb-[15px]"` for that one.
 */
export function WzDocSectionHead({
  title,
  icon,
  action,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-[38px] items-center justify-between gap-3 border-b border-wz-rule pb-1.5", className)}>
      <h3 className="flex min-w-0 items-center gap-2 text-[18px] leading-[22px] font-medium text-[#3b4c53] [&_svg]:size-5 [&_svg]:shrink-0">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}

/**
 * Workiz's totals box: 132×28, #f7f7f7 on a 1px #ccc line, r2, 14px #666 with
 * the input's normal tracking (pg_estimate_wz_01_job, job_b_tab_items).
 */
export const WZ_TOTALS_BOX =
  "h-7 w-[132px] shrink-0 truncate rounded-[2px] border border-input bg-[#f7f7f7] px-2.5 text-left text-[14px] leading-[26px] tracking-normal text-wz-text tabular-nums";

/**
 * One line of a document's totals: "Subtotal :" (14px #404040), 10px, then
 * the grey box. `underline` is Workiz's "Item cost :" / "Deposit :", labels
 * that open something; `onClick` makes the box that button. `colon="tight"`
 * is Workiz's "Discount:" (no space), `hint` sits between label and box (the
 * ⓘ). `after` hangs 10px right of the box without moving it (the invoice's
 * "Pay" beside "Balance :", pg_invoice_wz_01_partial). Rows are 33px apart:
 * lay them out with `flex flex-col items-end gap-[5px]`.
 */
export function WzTotalsBoxRow({
  label,
  children,
  colon = "spaced",
  underline,
  bold,
  hint,
  onClick,
  title,
  after,
  className,
}: {
  label: string;
  children: ReactNode;
  colon?: "spaced" | "tight";
  underline?: boolean;
  bold?: boolean;
  hint?: ReactNode;
  onClick?: () => void;
  title?: string;
  /** Beside the box, outside the column's edge (the box stays level with the others). */
  after?: ReactNode;
  className?: string;
}) {
  const box = cn(WZ_TOTALS_BOX, bold && "font-bold", onClick && "cursor-pointer hover:border-wz-link");
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-2.5", after != null && "relative", className)}>
      <span className={cn("text-[14px] leading-5 text-wz-strong", underline && "underline")}>
        {label}
        {colon === "tight" ? ":" : " :"}
      </span>
      {hint}
      {onClick ? (
        <button type="button" onClick={onClick} title={title} className={box}>
          {children}
        </button>
      ) : (
        <span title={title} className={box}>
          {children}
        </span>
      )}
      {after != null ? <span className="absolute top-0 left-full ml-2.5 flex h-7 items-center">{after}</span> : null}
    </div>
  );
}
