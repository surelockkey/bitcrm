import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The total card of Workiz's Payments report (`PaymentsReport-module__
 * cardContainer`, rep_payments_wz_01_default: "$130,302.80 / Total amount",
 * "$1,240.36 / Total tips"): 188×72, white, 8px corners, the shadow
 * `rgba(59,75,82,.05) 0 0 4px, rgba(59,75,82,.1) 0 4px 12px`, a 4px ink bar
 * down the left; the figure (h5) 16px/24px 500 ink with 0.2px tracking over
 * the caption 14px/21px #768287, 16px from the bar and the top.
 *
 * A figure, not a control. Named by `label` or the caption. (The Clients
 * page's card is `WzKpiCard`; the Phone page's `WzStatCard`.)
 */
export function WzTotalCard({
  value,
  caption,
  label,
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & {
  value: ReactNode;
  caption: ReactNode;
  /** Accessible name when the caption is not a plain string. */
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label ?? (typeof caption === "string" ? caption : undefined)}
      data-slot="wz-total-card"
      className={cn(
        "flex h-[72px] w-[188px] shrink-0 overflow-hidden rounded-[8px] bg-background shadow-[0_0_4px_0_rgba(59,75,82,0.05),0_4px_12px_0_rgba(59,75,82,0.1)]",
        className,
      )}
      {...props}
    >
      <span aria-hidden data-slot="wz-total-card-bar" className="w-1 shrink-0 bg-foreground" />
      <div className="min-w-0 px-4 pt-4">
        <div className="truncate text-base leading-6 font-medium tracking-[0.2px] text-foreground tabular-nums">{value}</div>
        <div className="truncate text-sm leading-[21px] tracking-[0.4px] text-wz-outline-label">{caption}</div>
      </div>
    </div>
  );
}
