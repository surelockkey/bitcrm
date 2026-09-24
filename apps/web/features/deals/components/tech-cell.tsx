"use client";

import { Check, Phone, Share2 } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import type { DirectoryUser } from "@/features/deals/hooks";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { techColor } from "../tech-color";

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
    <div className="flex flex-col items-start gap-1">
      {techIds.map((id) => {
        const u = userMap.get(id);
        const name = u ? `${u.firstName} ${u.lastName}`.trim() : id;
        return (
          <span
            key={id}
            className={cn(
              "inline-flex max-w-[190px] items-center truncate rounded px-1.5 py-0.5",
              "text-[11px] font-semibold uppercase tracking-wide text-white",
              techColor(id),
            )}
            title={name}
          >
            {name}
          </span>
        );
      })}

      {deal.sentToTechAt || deal.techConfirmedAt || deal.hasCalls ? (
        <div className="flex items-center gap-1">
          {deal.techConfirmedAt ? (
            <Mark
              label="Tech confirmed"
              says={`The technician confirmed this job${when(deal.techConfirmedAt)}`}
              tone="bg-green-600"
            >
              <Check className="size-2.5" strokeWidth={3} />
            </Mark>
          ) : null}
          {deal.sentToTechAt ? (
            <Mark
              label="Sent to tech"
              says={`The job was sent to the technician${when(deal.sentToTechAt)}`}
              tone="bg-blue-600"
            >
              <Share2 className="size-2.5" />
            </Mark>
          ) : null}
          {deal.hasCalls ? (
            <Mark label="Has a call" says="This job has a call on it" tone="bg-green-600">
              <Phone className="size-2.5" />
            </Mark>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The date part of a tooltip, left out when there is nothing to say. */
function when(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : ` on ${d.toLocaleString()}`;
}

/**
 * The icons are small on purpose — a dispatcher scans a column of them — so
 * hovering says in words what each one means. Nobody should have to learn
 * three glyphs to read the list.
 */
function Mark({
  label,
  says,
  tone,
  children,
}: {
  label: string;
  says: string;
  tone: string;
  children: React.ReactNode;
}) {
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
            className={cn("grid size-4 place-items-center rounded-[3px] text-white", tone)}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent>{says}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
