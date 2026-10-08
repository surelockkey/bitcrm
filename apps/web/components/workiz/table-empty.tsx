import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A grid with nothing in it, the way Workiz draws one (`_tableNoData`,
 * jobslist_wz_search_zzqxwv): a rgba(255,255,255,.6) wash over the whole
 * grid — header, zebra rows and dotted rules all fade (audit_pixels L2) — and
 * a centred 390px block 145px down: the picture (Workiz's is a laptop on a
 * pale disc; pass our own) over "No Jobs Found", 20px/400/25px #3e4b51.
 *
 * Put it inside the grid's `relative` frame, after the table, which keeps
 * drawing its blank zebra rows underneath.
 */
export function WzTableEmpty({
  title,
  art,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title"> & { title: ReactNode; art?: ReactNode }) {
  return (
    <div
      data-slot="wz-table-empty"
      className={cn("pointer-events-none absolute inset-0 z-10 bg-white/60", className)}
      {...props}
    >
      <div className="relative mx-auto mt-[145px] flex w-[390px] max-w-full flex-col items-center text-center">
        {art ? <div className="mb-6">{art}</div> : null}
        <h3 className="text-xl leading-[25px] font-normal text-wz-tab-bar">{title}</h3>
      </div>
    </div>
  );
}
