"use client";

import { useState } from "react";
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
import { GripVertical } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { WzMapPinCard, WzMapPinCardRow } from "@/components/workiz/map-pin";
import {
  isInTimeOrder,
  techJobProgress,
  technicianAvailability,
  type TechAvailability,
  type TechnicianPosition,
} from "../lib";
import { lastSeenText, pinCardWhen } from "../map-words";

const AVAILABILITY_LABEL: Record<TechAvailability, string> = {
  on_job: "On a job",
  available: "Available",
  offline: "Offline",
};

/** Workiz's `rowType` words: "Last seen:" in #768287, 8px before the value. */
function RowType({ children }: { children: string }) {
  return <span className="mr-2 text-wz-outline-label">{children}</span>;
}

function JobRow({
  deal,
  index,
  title,
  clientName,
  canReorder,
  onSelectJob,
}: {
  deal: Deal;
  index: number;
  title: string;
  clientName: string;
  canReorder: boolean;
  onSelectJob: (dealId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    disabled: !canReorder,
  });
  const when = pinCardWhen(deal);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 bg-white opacity-80" : undefined}
    >
      <div className="flex items-start gap-2">
        {canReorder ? (
          <button
            type="button"
            className="mt-0.5 cursor-grab touch-none text-wz-outline-label hover:text-foreground active:cursor-grabbing"
            aria-label={`Reorder job #${deal.dealNumber}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        ) : null}
        {/* Workiz's appointmentIndexBadge: the job's place in the day. */}
        <span className="mt-px inline-flex shrink-0 items-center justify-center rounded-[999px] bg-wz-secondary-hover px-2 py-0.5 text-xs leading-[1.2] font-semibold text-wz-outline-label">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={() => onSelectJob(deal.id)}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="block truncate text-sm leading-[21px] font-semibold">{title}</span>
          <span className="block truncate text-[13px] leading-[19px] text-wz-slate">
            {[clientName, when].filter(Boolean).join(" · ")}
          </span>
        </button>
      </div>
    </li>
  );
}

/**
 * The card a tech's pin opens (pg_dispatch_wz_13_tech_click): the name and
 * "Last seen:" the fix's time. Ours under it, in the card's own rows: whether
 * they are on a job, the street they are on, and the day's jobs in order — a
 * manager drags them to re-sequence (story 4.02:257).
 */
export function TechPinCard({
  position,
  name,
  address,
  jobs,
  title,
  clientName,
  canReorder,
  onReorder,
  onSelectJob,
  onClose,
}: {
  position: TechnicianPosition;
  name: string;
  /** The street they are on — the board looked it up with the roster. */
  address?: string;
  /** Their jobs today, in their order. */
  jobs: Deal[];
  title: (deal: Deal) => string;
  clientName: (deal: Deal) => string;
  /** Whether the viewer may drag to re-sequence (deals.edit). */
  canReorder: boolean;
  onReorder: (orderedDealIds: string[]) => void;
  onSelectJob: (dealId: string) => void;
  onClose: () => void;
}) {
  const availability = technicianAvailability(jobs, position);
  const progress = techJobProgress(jobs);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lng}`;

  // Local order for an optimistic drag; follows the server's set whenever it
  // changes — in the same render, not an effect's extra one after it.
  const [items, setItems] = useState<Deal[]>(jobs);
  const [itemsOf, setItemsOf] = useState<Deal[]>(jobs);
  if (itemsOf !== jobs) {
    setItemsOf(jobs);
    setItems(jobs);
  }

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

  const where =
    position.source === "live" ? null : position.source === "home" ? "Home address (no live GPS)" : "Last job today (no live GPS)";

  return (
    <WzMapPinCard title={name} onClose={onClose}>
      {position.source === "live" && position.updatedAt ? (
        <p>
          <RowType>Last seen:</RowType>
          {lastSeenText(position.updatedAt)}
        </p>
      ) : (
        <p>
          <RowType>Location:</RowType>
          {where}
        </p>
      )}
      <p>
        <RowType>Status:</RowType>
        {AVAILABILITY_LABEL[availability]}
        {progress.total > 0 ? ` · ${progress.current} of ${progress.total} jobs` : ""}
      </p>
      <WzMapPinCardRow rule>
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer" title="Open in Google Maps" className="hover:underline">
          {address ?? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`}
        </a>
      </WzMapPinCardRow>
      <div>
        {/* Workiz's highlightLabel: 12px semibold #768287, 8px over the list. */}
        <p className="mb-2 text-xs font-semibold text-wz-outline-label">Today&apos;s jobs ({items.length})</p>
        {!isInTimeOrder(items) ? (
          <p className="mb-2 text-[13px] leading-[19px] text-wz-danger">Jobs not in time order</p>
        ) : null}
        {items.length === 0 ? (
          <p className="text-wz-slate">No jobs scheduled today.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={items.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-2">
                {items.map((deal, i) => (
                  <JobRow
                    key={deal.id}
                    deal={deal}
                    index={i}
                    title={title(deal)}
                    clientName={clientName(deal)}
                    canReorder={canReorder}
                    onSelectJob={onSelectJob}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </WzMapPinCard>
  );
}
