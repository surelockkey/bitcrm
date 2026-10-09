"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The legacy reports' yellow button (Finance Reporting's Export · Fields ·
 * Print, rep_commission_wz_04_lastweek / _05_btn_hover): 32px, #ffd400, 13px
 * 600 #404040 tracked 0.5px, 15px in, a pill; #eac300 under the mouse and
 * while what it opened is open (`pressed`).
 */
export function WzLegacyPillButton({
  pressed = false,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        // #ffd400: Workiz's legacy yellow (button.xls_export), not the app's #fad400.
        "inline-flex h-8 cursor-pointer items-center rounded-pill px-[15px] text-[13px] leading-8 font-semibold tracking-[0.5px] whitespace-nowrap text-wz-strong outline-none hover:bg-wz-primary-hover focus-visible:ring-2 focus-visible:ring-wz-strong disabled:cursor-default disabled:opacity-60",
        pressed ? "bg-wz-primary-hover" : "bg-[#ffd400]",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface WzLegacySummaryRow {
  key: string;
  cells: ReactNode[];
}

/**
 * A titled summary table under a legacy report (Finance Reporting's "Total
 * Profits" and "Total by type"): h3 20px/25px #3e4b51 over a 1px #ddd rule
 * (11px under the words), the table 20px below — names 14px/16px 500 #404040
 * capitalised in 1px #ccc boxes (15px 18px), rows 11px/12px #404040 at 9px 5px
 * between #e6e6e6 rules with dotted #cfcfcf ones at the left. With no rows
 * only the names stand, as Workiz leaves an empty period.
 */
export function WzLegacySummary({
  title,
  columns,
  rows,
  className,
}: {
  title: string;
  columns: readonly string[];
  rows: readonly WzLegacySummaryRow[];
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <h3 className="border-b border-wz-frame pb-[11px] text-xl leading-[25px] font-normal tracking-[0.4px] text-wz-tab-bar">{title}</h3>
      <table
        aria-label={title}
        className="mt-5 w-full border-collapse border-r border-b border-r-table-border border-b-input bg-background tracking-[0.4px] text-wz-strong [border-right-style:dotted]"
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="border border-input px-[18px] py-[15px] text-left align-middle text-sm leading-4 font-medium capitalize">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) => (
                <td
                  key={i}
                  // #e6e6e6: the rule between rows (rep_commission_wz_04_lastweek_full).
                  className="border-t border-l border-t-[#e6e6e6] border-l-table-border px-[5px] py-[9px] text-left align-top text-[11px] leading-3 [border-left-style:dotted]"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
