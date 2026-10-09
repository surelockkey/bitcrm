"use client";

import { ESTIMATE_STATUSES, ESTIMATE_STATUS_LABELS, type EstimateStatus } from "@bitcrm/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ESTIMATE_STATUS_COLORS } from "@/features/reports/billing/lib";

/** The status word after Workiz's 8px dot (8px apart), as react-select's single value. */
function StatusWord({ status }: { status: EstimateStatus }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: ESTIMATE_STATUS_COLORS[status] }} />
      {ESTIMATE_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * The estimate's status on its page, as Workiz draws it (pg_estimate_wz_01_job,
 * pg_estimate_wz_02_client): a borderless react-select — the coloured dot, the
 * word in #333 and a thin chevron — whose list shows every status with its dot.
 * `size="band"`: the job estimate's band (14px/24px); `"header"`: the client
 * estimate's header (16px).
 */
export function EstimateStatusSelect({
  value,
  onChange,
  disabled,
  id,
  className,
  size = "band",
}: {
  value: EstimateStatus;
  onChange: (status: EstimateStatus) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
  size?: "band" | "header";
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as EstimateStatus)} disabled={disabled}>
      <SelectTrigger
        id={id}
        size="sm"
        aria-label="Estimate status"
        className={cn(
          "w-full justify-between gap-2 rounded-none border-0 bg-transparent p-0 text-wz-value shadow-none hover:border-0 disabled:bg-transparent disabled:text-wz-value data-[size=sm]:pl-0 data-[state=open]:shadow-none [&>svg]:size-4! [&>svg]:text-wz-caption! [&>svg]:transition-transform data-[state=open]:[&>svg]:rotate-180",
          size === "band" ? "h-6 text-[14px] leading-6 data-[size=sm]:h-6" : "h-[35px] text-[16px] leading-4 data-[size=sm]:h-[35px]",
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-[169px] min-w-[169px]">
        {ESTIMATE_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="pr-3 text-[14px] text-foreground [&>span:first-child]:hidden">
            <StatusWord status={s} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
