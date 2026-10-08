import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A Workiz report grid with nothing in it (react-table `.rt-noData`,
 * pg_contacts_wz_05_search_empty — the Clients, Estimates, Invoices lists):
 * the blank zebra rows stay, and over them, 203px under the grid's top edge,
 * "No Records Found" in 15px/500 #404040 on a white-70% band. (The Jobs list
 * draws its own, bigger "No Jobs Found" — `WzTableEmpty`.)
 *
 * Put it inside the grid's `relative` frame, after the table.
 */
export function WzTableNoData({
  children = "No Records Found",
  className,
  ...props
}: Omit<ComponentProps<"div">, "children"> & { children?: ReactNode }) {
  return (
    <div
      data-slot="wz-table-no-data"
      role="status"
      className={cn(
        "pointer-events-none absolute top-[203px] left-1/2 z-10 -translate-x-1/2 bg-white/70 px-4 leading-4",
        className,
      )}
      {...props}
    >
      <span className="text-[15px] leading-4 font-medium tracking-[0.4px] whitespace-nowrap text-wz-strong">{children}</span>
    </div>
  );
}
