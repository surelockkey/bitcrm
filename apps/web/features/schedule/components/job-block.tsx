"use client";

import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { techColor } from "@/features/dispatch/tech-color";
import { StageBadge } from "@/features/deals/components/deal-badges";
import type { ConflictReason, DayBlock } from "../lib";

/** The visual card for a job block; fills its positioned parent (the draggable). */
export function JobBlock({
  block,
  techId,
  clientName,
  conflicts,
  onOpenOverflow,
}: {
  block: DayBlock;
  techId: string;
  clientName: string;
  conflicts: ConflictReason[];
  onOpenOverflow?: () => void;
}) {
  const { deal } = block;
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-md border bg-card px-2 py-1 text-xs shadow-sm",
        conflicts.length > 0 && "ring-1 ring-amber-500/60",
      )}
      style={{ borderLeft: `3px solid ${techColor(techId)}` }}
    >
      <div className="flex items-center gap-1 font-medium">
        <span className="truncate">
          #{deal.dealNumber} · {clientName}
        </span>
        {conflicts.length > 0 ? (
          <TriangleAlert className="size-3 flex-none text-amber-600" />
        ) : null}
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
        <span className="truncate">{deal.scheduledTimeSlot}</span>
        <StageBadge stage={deal.stage} className="scale-90" />
      </div>
      {block.overflowCount > 0 ? (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onOpenOverflow}
          className="absolute right-1 bottom-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium hover:bg-muted-foreground/20"
        >
          +{block.overflowCount} more
        </button>
      ) : null}
    </div>
  );
}
