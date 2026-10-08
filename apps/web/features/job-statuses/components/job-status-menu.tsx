"use client";

import { ChevronDown } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import type { JobSuperStatus, JobTagColor } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { superStatusLabel } from "@/features/deals/lib";
import { useJobStatuses } from "../hooks";
import { jobStatusMap, STATUS_SWATCH_CLASSES } from "../lib";
import { SUPER_PREFIX, statusMenuRows, statusMenuValue, superDotColor } from "../status-menu";

export interface JobStatusMenuValue {
  superStatus: JobSuperStatus;
  subStatusId?: string;
}

function Dot({ superStatus, color }: { superStatus: JobSuperStatus; color?: JobTagColor }) {
  return color ? (
    <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", STATUS_SWATCH_CLASSES[color])} />
  ) : (
    <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: superDotColor(superStatus) }} />
  );
}

/**
 * The job header's "Status:" picker in Workiz's dress (job_b_02_status_open):
 * a 216×27 grey (#ddd) box with the status's dot, and a white menu listing
 * every super-status with its sub-statuses indented under it. Selecting a
 * sub-status also sets its super-status; a bare super-status clears the sub.
 */
export function JobStatusMenu({
  value,
  onChange,
  disabled,
}: {
  value: JobStatusMenuValue;
  onChange: (v: JobStatusMenuValue) => void;
  disabled?: boolean;
}) {
  const { data } = useJobStatuses();
  const current = value.subStatusId ? jobStatusMap(data).get(value.subStatusId) : undefined;
  const rows = statusMenuRows(data);

  const handle = (v: string) => {
    if (v.startsWith(SUPER_PREFIX)) {
      onChange({ superStatus: v.slice(SUPER_PREFIX.length) as JobSuperStatus });
      return;
    }
    const row = rows.find((r) => r.value === v);
    onChange({ superStatus: row?.superStatus ?? value.superStatus, subStatusId: v });
  };

  return (
    <SelectPrimitive.Root value={statusMenuValue(value)} onValueChange={handle} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label="Job status"
        className={cn(
          // 216×27, #ddd, r6, 13px #333 — the Workiz control, open = 1px yellow ring.
          "inline-flex h-[27px] w-[216px] items-center gap-1.5 rounded-[6px] bg-[#dddddd] pr-2 pl-2.5 text-left text-[13px] leading-4 text-[#333333] outline-none",
          "data-[state=open]:shadow-[0_0_0_1px_#ffd400] focus-visible:shadow-[0_0_0_1px_#ffd400] disabled:cursor-default",
        )}
      >
        <Dot superStatus={value.superStatus} color={current?.color} />
        <span className="min-w-0 flex-1 truncate">{current?.name ?? superStatusLabel(value.superStatus)}</span>
        {disabled ? null : (
          <SelectPrimitive.Icon asChild>
            <ChevronDown className="size-4 shrink-0 text-[#333333]" strokeWidth={2.5} />
          </SelectPrimitive.Icon>
        )}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-50 max-h-[300px] w-[216px] overflow-hidden rounded-[4px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]"
        >
          <SelectPrimitive.Viewport className="max-h-[300px] py-1">
            {rows.map((row) => (
              <SelectPrimitive.Item
                key={row.value}
                value={row.value}
                className={cn(
                  // Option: 14px, padding 8 12 8 10; a sub-status sits 10px further in.
                  "flex cursor-default items-center gap-1.5 py-2 pr-3 text-[14px] leading-4 text-[#404040] outline-none select-none",
                  row.kind === "sub" ? "pl-5" : "pl-2.5",
                  "data-highlighted:bg-[#deebff] data-[state=checked]:bg-[#2684ff] data-[state=checked]:text-white",
                )}
              >
                <Dot superStatus={row.superStatus} color={row.kind === "sub" ? row.color : undefined} />
                <SelectPrimitive.ItemText>{row.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
