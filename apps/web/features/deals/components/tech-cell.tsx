"use client";

import { Check, Phone, Share2 } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import type { DirectoryUser } from "@/features/deals/hooks";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { DEFAULT_TZ } from "@/lib/timezone";
import { techColor } from "../tech-color";
import { workizDateTime } from "../schedule-cell";

/**
 * The Tech column as a dispatcher reads it in Workiz: the technician in their
 * own colour, and under it the three things worth knowing at a glance — the
 * job went out, the technician confirmed it, and there is a call on it.
 *
 * The marks are about the job, not about the chip above them: in Workiz a job
 * with nobody assigned still shows the call mark, so they are rendered
 * independently.
 */
export function TechCell({
  deal,
  userMap,
}: {
  deal: Deal;
  userMap: Map<string, DirectoryUser>;
}) {
  const techIds = deal.assignedTechIds ?? [];

  return (
    // list_01: each chip, and the row of marks, on its own 24px line.
    <div className="flex flex-col items-start *:mb-2.5">
      {techIds.map((id) => {
        const u = userMap.get(id);
        const name = `${u?.firstName ?? ""} ${u?.lastName ?? ""}`.trim();
        // The directory arrives a moment after the jobs do. A uuid in this
        // column is worse than nothing — unreadable, and it looks broken — so
        // the chip keeps its colour and waits for the name.
        return (
          <span
            key={id}
            aria-label="Technician"
            className={cn(
              // Workiz's tech chip: 10px/500 capitals, 14px tall, 4px sides, radius 2.
              "inline-flex max-w-full items-center rounded-chip px-1 whitespace-nowrap",
              "text-[10px] leading-[14px] font-medium tracking-[0.4px] uppercase text-white",
              techColor(id),
              name ? "" : "min-w-16 animate-pulse opacity-60",
            )}
            title={name || undefined}
          >
            {name || "\u00a0"}
          </span>
        );
      })}

      {deal.sentToTechAt || confirmedAt(deal) || deal.hasCalls ? (
        <div className="flex items-center gap-2">
          {confirmedAt(deal) ? (
            <Mark label="Tech confirmed" at={confirmedAt(deal)} tone="bg-[#99c624]">
              <Check className="size-2.5" strokeWidth={3} />
            </Mark>
          ) : null}
          {deal.sentToTechAt ? (
            <Mark label="Sent to tech" at={deal.sentToTechAt} tone="bg-[#0059a0]">
              <Share2 className="size-2.5" />
            </Mark>
          ) : null}
          {deal.hasCalls ? (
            <Mark label="Has a call" tone="bg-[#99c624]">
              <Phone className="size-2.5" />
            </Mark>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The green tick. Workiz has no separate "confirmed" — its tick means the
 * technician opened the job — so a migrated job earns it by having been seen,
 * and one confirmed in our own app earns it outright.
 */
function confirmedAt(deal: Deal): string | undefined {
  return deal.techConfirmedAt ?? deal.seenByTechAt;
}

/**
 * The icons are small on purpose — a dispatcher scans a column of them — so
 * hovering says what each one means, Workiz-short ("Tech confirmed"), and
 * when, in the app's own format on the account's clock (audit L6).
 */
function Mark({
  label,
  at,
  tone,
  children,
}: {
  label: string;
  at?: string;
  tone: string;
  children: React.ReactNode;
}) {
  const stamp = workizDateTime(at, DEFAULT_TZ);
  const says = stamp ? `${label} · ${stamp}` : label;
  // Its own provider: the cell is rendered from a table, a dialog and a test,
  // and none of them should have to know a tooltip lives in here. Nesting one
  // inside the app's root provider is harmless.
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            aria-label={label}
            aria-description={says}
            // Workiz's marks: 15px squares, radius 2, its green #99c624 and
            // blue #0059a0 (sampled off list_01_submitted).
            className={cn("grid size-[15px] place-items-center rounded-chip text-white", tone)}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <div>{label}</div>
          {stamp ? <div className="opacity-80">{stamp}</div> : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
