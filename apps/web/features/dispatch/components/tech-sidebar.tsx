"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis, restrictToParentElement } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MapPin, TriangleAlert, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { useJobTypeName } from "@/features/job-types/lib";
import { techColor } from "../tech-color";
import { useReverseGeocode } from "../use-reverse-geocode";
import {
  formatAge,
  isInTimeOrder,
  technicianAvailability,
  type TechAvailability,
  type TechnicianPosition,
} from "../lib";

const AVAILABILITY_LABEL: Record<TechAvailability, string> = {
  on_job: "On a job",
  available: "Available",
  offline: "Offline",
};

const AVAILABILITY_DOT: Record<TechAvailability, string> = {
  on_job: "bg-amber-500",
  available: "bg-emerald-500",
  offline: "bg-zinc-400",
};

function locationLine(position: TechnicianPosition): string {
  if (position.source === "live") {
    const age = formatAge(position.updatedAt, Date.now());
    return position.stale ? `Last seen ${age}` : `Live · ${age}`;
  }
  return position.source === "home" ? "At home (no live GPS)" : "At last job (no live GPS)";
}

function JobRow({
  deal,
  index,
  clientName,
  canReorder,
  onSelectJob,
}: {
  deal: Deal;
  index: number;
  clientName: (deal: Deal) => string;
  canReorder: boolean;
  onSelectJob: (dealId: string) => void;
}) {
  const jobTypeName = useJobTypeName();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: !canReorder,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <div className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-2">
        {canReorder ? (
          <button
            type="button"
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder job #${deal.dealNumber}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onSelectJob(deal.id)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              #{deal.dealNumber} · {clientName(deal)}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {jobTypeName(deal.jobTypeId)}
              {deal.scheduledTimeSlot ? ` · ${deal.scheduledTimeSlot}` : ""}
            </span>
          </span>
          <StageBadge stage={deal.stage} />
        </button>
      </div>
    </li>
  );
}

/**
 * Technician details next to the map — the counterpart to `JobSidebar`. Shows
 * who they are, where they are, and their day's jobs in order (story v0:337).
 * A manager can drag the jobs to re-sequence them (story 4.02:257).
 */
export function TechSidebar({
  position,
  name,
  jobs,
  clientName,
  canReorder,
  onReorder,
  onClose,
  onSelectJob,
}: {
  position: TechnicianPosition;
  name: string;
  /** The technician's jobs today, ordered by time slot. */
  jobs: Deal[];
  clientName: (deal: Deal) => string;
  /** Whether the viewer may drag to re-sequence (deals.edit). */
  canReorder: boolean;
  onReorder: (orderedDealIds: string[]) => void;
  onClose: () => void;
  onSelectJob: (dealId: string) => void;
}) {
  // Only the selected technician is geocoded here — cheap, and cached by coords.
  const address = useReverseGeocode([position]).get(position.userId);
  const availability = technicianAvailability(jobs, position);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`;

  // Local order for optimistic drag; resyncs whenever the server's job set changes.
  const [items, setItems] = useState<Deal[]>(jobs);
  useEffect(() => {
    setItems(jobs);
  }, [jobs]);

  const sensors = useSensors(
    // A small drag threshold keeps a plain click on the grip from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((d) => d.id === active.id);
    const newIndex = items.findIndex((d) => d.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic
    onReorder(next.map((d) => d.id));
  };

  const outOfOrder = !isInTimeOrder(items);

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span
          className="size-3 rounded-full ring-2 ring-white"
          style={{ backgroundColor: techColor(position.userId) }}
        />
        <span className="truncate text-sm font-semibold">{name}</span>
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          onClick={onClose}
          aria-label="Close technician details"
        >
          <X className="size-4" />
        </Button>
      </div>

      <div className="border-b px-4 py-3">
        <div className="flex items-center gap-1.5 text-sm">
          <span className={`size-2 rounded-full ${AVAILABILITY_DOT[availability]}`} />
          {AVAILABILITY_LABEL[availability]}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{locationLine(position)}</div>
        {address ? <div className="mt-1 text-sm">{address}</div> : null}
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <MapPin className="size-3.5" /> Open in Google Maps
        </a>
      </div>

      <div className="px-4 py-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Today&apos;s jobs · {items.length}
        </div>

        {outOfOrder ? (
          <div className="mb-2 flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
            <TriangleAlert className="size-3.5 shrink-0" />
            Jobs not in time order
          </div>
        ) : null}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs scheduled today.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              <ol className="space-y-1.5">
                {items.map((deal, i) => (
                  <JobRow
                    key={deal.id}
                    deal={deal}
                    index={i}
                    clientName={clientName}
                    canReorder={canReorder}
                    onSelectJob={onSelectJob}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </aside>
  );
}
