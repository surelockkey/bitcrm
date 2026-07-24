"use client";

import { useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CalendarEvent, Deal, TechnicianProfile, User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { techColor } from "@/features/dispatch/tech-color";
import {
  blockGeometry,
  computeDayWindow,
  dealConflicts,
  eventOnDate,
  layoutDayColumn,
  outOfHoursBands,
  slotMinutes,
  eventLabel,
  type Grid,
} from "../lib";
import { JobBlock } from "./job-block";

export interface RescheduleTarget {
  deal: Deal;
  newTechId: string;
  newSlot: string;
}

const HOUR_PX = 56;
const MIN_BLOCK_PX = 24;

function techName(id: string, users: Map<string, User>): string {
  const u = users.get(id);
  if (!u) return "Technician";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

function clientName(deal: Deal, contacts: Map<string, { firstName: string; lastName: string }>): string {
  const c = contacts.get(deal.contactId);
  return c ? `${c.firstName} ${c.lastName}`.trim() : "Client";
}

/** Reposition a slot so it starts at `hour:00`, preserving its duration. */
function slotAtHour(slot: string | undefined, hour: number): string {
  const dur = slot ? slotMinutes(slot) : 60;
  const start = hour * 60;
  const end = Math.min(start + dur, 24 * 60);
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${fmt(start)}-${fmt(end)}`;
}

export function DayGrid({
  dateISO,
  techIds,
  deals,
  events,
  profiles,
  users,
  contacts,
  readOnly,
  onReschedule,
}: {
  dateISO: string;
  techIds: string[];
  deals: Deal[];
  events: CalendarEvent[];
  profiles: Map<string, TechnicianProfile>;
  users: Map<string, User>;
  contacts: Map<string, { firstName: string; lastName: string }>;
  readOnly: boolean;
  onReschedule: (t: RescheduleTarget) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dayDeals = useMemo(
    () => deals.filter((d) => d.scheduledDate === dateISO && d.assignedTechId),
    [deals, dateISO],
  );

  // The grid window grows past the 7–19 baseline to fit early/late jobs and the
  // visible technicians' working hours, so nothing is clipped off the top/bottom.
  const grid: Grid = useMemo(() => {
    const visibleProfiles = new Map<string, TechnicianProfile>();
    for (const id of techIds) {
      const p = profiles.get(id);
      if (p) visibleProfiles.set(id, p);
    }
    const win = computeDayWindow(
      dayDeals.filter((d) => techIds.includes(d.assignedTechId!)),
      visibleProfiles,
      dateISO,
    );
    return { ...win, hourPx: HOUR_PX, minBlockPx: MIN_BLOCK_PX };
  }, [dayDeals, profiles, techIds, dateISO]);

  const hours = useMemo(
    () => Array.from({ length: grid.endHour - grid.startHour }, (_, i) => grid.startHour + i),
    [grid],
  );

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const deal = e.active.data.current?.deal as Deal | undefined;
    if (!deal) return;
    const [newTechId, hourStr] = String(e.over.id).split(":");
    const newSlot = slotAtHour(deal.scheduledTimeSlot, Number(hourStr));
    if (newTechId === deal.assignedTechId && newSlot === deal.scheduledTimeSlot) return;
    onReschedule({ deal, newTechId, newSlot });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex overflow-x-auto">
        {/* Hour gutter */}
        <div className="sticky left-0 z-10 w-14 flex-none bg-background">
          <div className="h-10 border-b" />
          {hours.map((h) => (
            <div key={h} className="relative border-b text-[10px] text-muted-foreground" style={{ height: grid.hourPx }}>
              <span className="absolute -top-1.5 right-1">{String(h).padStart(2, "0")}:00</span>
            </div>
          ))}
        </div>

        {techIds.map((techId) => {
          const techDeals = dayDeals.filter((d) => d.assignedTechId === techId);
          const layout = layoutDayColumn(techDeals, grid);
          const wh = profiles.get(techId) ?? {};
          const bands = outOfHoursBands(wh, dateISO, grid);
          const dayEvents = events.filter((e) => e.technicianId === techId && eventOnDate(e, dateISO));

          return (
            <div key={techId} className="w-56 flex-none border-r">
              <div className="flex h-10 items-center gap-1.5 border-b px-2">
                <span className="size-2 flex-none rounded-full" style={{ background: techColor(techId) }} />
                <span className="truncate text-sm font-medium">{techName(techId, users)}</span>
                <span className="ml-auto text-xs text-muted-foreground">{techDeals.length}</span>
              </div>

              <div className="relative" style={{ height: hours.length * grid.hourPx }}>
                {/* out-of-hours dimming */}
                {bands.map((b, i) => (
                  <div key={i} className="absolute inset-x-0 bg-muted/50" style={{ top: b.topPx, height: b.heightPx }} />
                ))}
                {/* hour lines + droppable cells */}
                {hours.map((h) => (
                  <DropCell key={h} id={`${techId}:${h}`} readOnly={readOnly} top={(h - grid.startHour) * grid.hourPx} height={grid.hourPx} />
                ))}
                {/* time-off / lunch blocks (non-draggable) */}
                {dayEvents.map((ev) => {
                  const geo = ev.allDay
                    ? { topPx: 0, heightPx: hours.length * grid.hourPx }
                    : blockGeometry(ev.timeSlot!, grid);
                  return (
                    <div
                      key={ev.id}
                      className="absolute right-1 left-1 rounded-md border border-dashed bg-muted/70 px-2 py-1 text-[11px] text-muted-foreground"
                      style={{ top: geo.topPx, height: geo.heightPx }}
                    >
                      {eventLabel(ev.type)}
                      {ev.title ? ` · ${ev.title}` : ""}
                    </div>
                  );
                })}
                {/* job blocks (draggable) */}
                {layout.blocks.map((block) => (
                  <DraggableBlock
                    key={block.deal.id}
                    deal={block.deal}
                    techId={techId}
                    disabled={readOnly}
                    topPx={block.topPx}
                    heightPx={block.heightPx}
                  >
                    <JobBlock
                      block={block}
                      techId={techId}
                      clientName={clientName(block.deal, contacts)}
                      conflicts={dealConflicts(block.deal, techDeals, dayEvents, wh)}
                    />
                  </DraggableBlock>
                ))}
                {/* unscheduled tray hint */}
                {layout.unscheduled.length > 0 ? (
                  <div className="absolute inset-x-1 bottom-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] text-amber-700">
                    {layout.unscheduled.length} unscheduled
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}

function DropCell({ id, readOnly, top, height }: { id: string; readOnly: boolean; top: number; height: number }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: readOnly });
  return (
    <div
      ref={setNodeRef}
      className={cn("absolute inset-x-0 border-b", isOver && "bg-brand/10")}
      style={{ top, height }}
    />
  );
}

function DraggableBlock({
  deal,
  techId,
  disabled,
  topPx,
  heightPx,
  children,
}: {
  deal: Deal;
  techId: string;
  disabled: boolean;
  topPx: number;
  heightPx: number;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: deal.id,
    data: { deal, techId },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn("absolute right-1 left-1 z-20", !disabled && "cursor-grab", isDragging && "z-30 opacity-70")}
      style={{
        top: topPx,
        height: heightPx,
        transform: CSS.Translate.toString(transform),
      }}
    >
      {children}
    </div>
  );
}
