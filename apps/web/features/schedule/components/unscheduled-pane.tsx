"use client";

import { useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CalendarOff, GripVertical, UserCheck, UserX, X } from "lucide-react";
import type { Contact, Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { dealClientName } from "@/features/deals/lib";

/**
 * Workiz's "Unscheduled jobs" pane (unscheduledJobsPane-module,
 * pg_schedule_wz_11_unscheduled_open / 11b_unscheduled_hover): a 370px panel
 * at the right, its title and "Drag and drop to schedule the job.", then a
 * card per job — "Job #X", the job type (N/A without one), the client — tinted
 * with its technician's colour, or pale with an ink edge when nobody is on it.
 * A card dragged onto the calendar schedules the job there.
 */
export function UnscheduledPane({
  deals,
  contacts,
  jobTypeName,
  techColor,
  readOnly,
  onOpen,
  onClose,
}: {
  deals: Deal[];
  contacts: Map<string, Contact>;
  jobTypeName: (id: string) => string;
  techColor: (id: string) => string;
  readOnly: boolean;
  onOpen: (deal: Deal) => void;
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Unscheduled jobs"
      className="relative z-40 -mt-px flex w-[370px] shrink-0 flex-col overflow-y-auto bg-white px-10 pt-6 pb-[70px] shadow-[-4px_0_8px_0_rgba(0,0,0,0.12)]"
    >
      <div className="flex items-start justify-between">
        <h4 className="text-[18px] leading-[27px] font-semibold text-foreground">Unscheduled jobs</h4>
        <button type="button" aria-label="Close" onClick={onClose} className="-mr-[2px] mt-[2px] text-foreground">
          <X className="size-6" strokeWidth={1.5} />
        </button>
      </div>
      <p className="mt-1 text-[14px] leading-[21px] text-wz-outline-label">Drag and drop to schedule the job.</p>
      {deals.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-4 text-center">
          <CalendarOff aria-hidden className="size-16 text-wz-outline" strokeWidth={1} />
          <p className="text-[14px] leading-[21px] text-foreground">You have no unscheduled jobs</p>
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {deals.map((deal) => (
            <li key={deal.id}>
              <JobCard
                deal={deal}
                client={dealClientName(deal, contacts.get(deal.contactId))}
                jobType={jobTypeName(deal.jobTypeId) || "N/A"}
                color={deal.assignedTechIds[0] ? techColor(deal.assignedTechIds[0]) : undefined}
                readOnly={readOnly}
                onOpen={() => onOpen(deal)}
              />
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

/** One card (unscheduledJobCard-module): 290×99, 8px corners, 13px 16px in, three 14px/21px lines. */
function JobCard({
  deal,
  client,
  jobType,
  color,
  readOnly,
  onOpen,
}: {
  deal: Deal;
  client: string;
  jobType: string;
  /** The technician's colour; none when the job has nobody on it. */
  color?: string;
  readOnly: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `card:${deal.id}`,
    data: { kind: "card", deal },
    disabled: readOnly,
  });
  const dragged = useRef(false);
  useEffect(() => {
    if (isDragging) dragged.current = true;
  }, [isDragging]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Job #${deal.dealNumber}`}
      aria-disabled={undefined}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className={cn(
        "group relative h-[99px] cursor-pointer rounded-[8px] border px-4 pt-[17px] pb-[13px] text-[14px] leading-[21px] text-foreground hover:shadow-[0_4px_4px_0_rgba(0,0,0,0.15)]",
        !color && "border-foreground bg-wz-secondary-hover",
        isDragging && "z-50 opacity-70 shadow-[0_4px_4px_0_rgba(0,0,0,0.15)]",
      )}
      style={{
        ...(color ? { borderColor: color, backgroundColor: `${color}50` } : null),
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      {!readOnly ? (
        <GripVertical
          aria-hidden
          className="absolute top-1/2 -left-[22px] size-5 -translate-y-1/2 text-wz-outline-label opacity-0 group-hover:opacity-100"
        />
      ) : null}
      <div className="truncate pr-8 font-semibold">Job #{deal.dealNumber}</div>
      <div className="truncate">{jobType}</div>
      <div className="mt-1 truncate">{client}</div>
      {color ? (
        <UserCheck aria-label="Assigned" className="absolute top-[19px] right-4 size-5 text-wz-text" strokeWidth={1.5} />
      ) : (
        <UserX aria-label="Unassigned" className="absolute top-[19px] right-4 size-5 text-wz-danger" strokeWidth={1.5} />
      )}
    </div>
  );
}
