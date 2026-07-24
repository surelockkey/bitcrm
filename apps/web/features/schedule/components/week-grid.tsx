"use client";

import { useMemo } from "react";
import type { CalendarEvent, Deal, User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { techColor } from "@/features/dispatch/tech-color";
import { weekDays, eventOnDate, dayOfWeek } from "../lib";

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function techName(id: string, users: Map<string, User>): string {
  const u = users.get(id);
  if (!u) return "Technician";
  return `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email;
}

/**
 * Deliberately low-density week: a count + up to two dots per cell, never
 * proportional blocks — that density is what made the old month view unusable.
 */
export function WeekGrid({
  anchorISO,
  techIds,
  deals,
  events,
  users,
  onPickDay,
}: {
  anchorISO: string;
  techIds: string[];
  deals: Deal[];
  events: CalendarEvent[];
  users: Map<string, User>;
  onPickDay: (dateISO: string) => void;
}) {
  const days = useMemo(() => weekDays(anchorISO), [anchorISO]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="w-40 border-b p-2 text-left text-xs font-semibold text-muted-foreground">Technician</th>
            {days.map((d, i) => (
              <th key={d} className="border-b border-l p-2 text-center text-xs font-medium text-muted-foreground">
                {DOW_LABELS[i]} <span className="text-muted-foreground/70">{d.slice(8)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {techIds.map((techId) => (
            <tr key={techId}>
              <td className="border-b p-2">
                <div className="flex items-center gap-1.5">
                  <span className="size-2 flex-none rounded-full" style={{ background: techColor(techId) }} />
                  <span className="truncate font-medium">{techName(techId, users)}</span>
                </div>
              </td>
              {days.map((day) => {
                const jobs = deals.filter(
                  (d) => d.scheduledDate === day && d.assignedTechId === techId,
                );
                const off = events.some(
                  (e) => e.technicianId === techId && e.allDay && eventOnDate(e, day),
                );
                return (
                  <td
                    key={day}
                    className={cn(
                      "cursor-pointer border-b border-l p-2 align-top hover:bg-muted/40",
                      off && "bg-muted/50",
                    )}
                    onClick={() => onPickDay(day)}
                  >
                    {off ? (
                      <span className="text-[11px] text-muted-foreground">Time off</span>
                    ) : jobs.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-medium">
                          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
                        </span>
                        <span className="flex gap-0.5">
                          {jobs.slice(0, 2).map((j) => (
                            <span key={j.id} className="size-1.5 rounded-full" style={{ background: techColor(techId) }} />
                          ))}
                          {jobs.length > 2 ? (
                            <span className="text-[10px] text-muted-foreground">+{jobs.length - 2}</span>
                          ) : null}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/50">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Exposed for reuse/testing: which weekday index (0=Mon..6=Sun) a date maps to. */
export function weekdayIndex(dateISO: string): number {
  const dow = dayOfWeek(dateISO);
  return dow === 0 ? 6 : dow - 1;
}
