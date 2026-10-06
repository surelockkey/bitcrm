"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CalendarPlus, Search } from "lucide-react";
import type { Deal, TechnicianProfile } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import * as dealApi from "@/features/deals/api";
import { todayISO } from "@/features/dispatch/lib";
import { dealConflicts, eventOnDate, filterTechnicians, type ConflictReason } from "../lib";
import { useScheduleBoard, type ScheduleBoard, type ScheduleView } from "../use-schedule-board";
import { DayGrid, type RescheduleTarget } from "./day-grid";
import { WeekGrid } from "./week-grid";
import { TimeOffDialog } from "./time-off-dialog";
import { RescheduleConfirmDialog } from "./reschedule-confirm-dialog";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);

/** Before the first grid is in: nothing to draw yet. */
const NO_BOARD: ScheduleBoard = {
  view: "day",
  date: "",
  deals: [],
  events: [],
  contacts: new Map(),
  profiles: [],
  users: new Map(),
};

export function SchedulePage() {
  const { can } = usePermissions();
  const denied = useDenied();
  const qc = useQueryClient();
  const [view, setView] = useState<ScheduleView>("day");
  const [date, setDate] = useState(todayISO());
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [pending, setPending] = useState<RescheduleTarget | null>(null);
  const [activeOnly, setActiveOnly] = useState(true);
  const [query, setQuery] = useState("");

  const canView = can("deals", "view");
  const canManage = can("technicians", "edit");

  // The grid as it was last complete: the day or week picked in the toolbar
  // replaces it once all of that one is in, not piece by piece.
  const { board } = useScheduleBoard({ view, date }, canView);
  const { deals, events, contacts, profiles, users } = board ?? NO_BOARD;

  const visibleProfiles = useMemo(
    () => filterTechnicians(profiles, users, { activeOnly, query }),
    [profiles, users, activeOnly, query],
  );
  const techIds = useMemo(() => visibleProfiles.map((p) => p.userId), [visibleProfiles]);

  const profileMap = useMemo(() => {
    const m = new Map<string, TechnicianProfile>();
    for (const p of profiles) m.set(p.userId, p);
    return m;
  }, [profiles]);

  const reschedule = useMutation({
    mutationFn: async (t: RescheduleTarget) => {
      await dealApi.updateDeal(t.deal.id, { scheduledTimeSlot: t.newSlot } as never);
      if (t.newTechId !== t.fromTechId) {
        // Swap just the dragged technician; the rest of the crew stays on the deal.
        await dealApi.assignTechs(
          t.deal.id,
          t.deal.assignedTechIds.map((id) => (id === t.fromTechId ? t.newTechId : id)),
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      toast.success("Job rescheduled");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  // Conflicts for the pending drag, computed client-side against loaded data.
  const pendingConflicts: ConflictReason[] = useMemo(() => {
    if (!pending) return [];
    const preview: Deal = {
      ...pending.deal,
      assignedTechIds: pending.deal.assignedTechIds.map((id) =>
        id === pending.fromTechId ? pending.newTechId : id,
      ),
      scheduledTimeSlot: pending.newSlot,
    };
    const sameDay = deals.filter(
      (d) =>
        d.id !== preview.id &&
        d.scheduledDate === preview.scheduledDate &&
        d.assignedTechIds.includes(pending.newTechId),
    );
    const techEvents = events.filter(
      (e) => e.technicianId === pending.newTechId && preview.scheduledDate && eventOnDate(e, preview.scheduledDate),
    );
    return dealConflicts(preview, sameDay, techEvents, profileMap.get(pending.newTechId) ?? {});
  }, [pending, deals, events, profileMap]);

  // Refused only once the permissions say so — not on every refresh while
  // they are still on their way.
  if (denied("deals", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view the schedule.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Schedule</h1>
        <Tabs value={view} onValueChange={(v) => setView(v as ScheduleView)}>
          <TabsList>
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Previous" onClick={() => setDate(shift(date, view === "day" ? -1 : -7))}>
            <ChevronLeft className="size-4" />
          </Button>
          <Input type="date" className="h-9 w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <Button variant="ghost" size="icon" aria-label="Next" onClick={() => setDate(shift(date, view === "day" ? 1 : 7))}>
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDate(todayISO())}>Today</Button>
        </div>

        {canManage ? (
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setTimeOffOpen(true)}>
            <CalendarPlus className="size-4" />
            Add time off
          </Button>
        ) : null}
      </div>

      {/* Technician filters */}
      <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-6 py-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 w-48 pl-7"
            placeholder="Search technicians…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Select value={activeOnly ? "active" : "all"} onValueChange={(v) => setActiveOnly(v === "active")}>
          <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>

        {/* Counted once the roster and its names are in — a "0" that becomes
            "69" a moment later is a number the reader never needed. */}
        {board ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {techIds.length} {techIds.length === 1 ? "technician" : "technicians"}
          </span>
        ) : null}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {!board ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Loading technicians…</p>
        ) : techIds.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No technicians to schedule.</p>
        ) : board.view === "day" ? (
          <DayGrid
            dateISO={board.date}
            techIds={techIds}
            deals={deals}
            events={events}
            profiles={profileMap}
            users={users}
            contacts={contacts}
            readOnly={!canManage}
            onReschedule={setPending}
          />
        ) : (
          <WeekGrid
            anchorISO={board.date}
            techIds={techIds}
            deals={deals}
            events={events}
            users={users}
            onPickDay={(d) => {
              setDate(d);
              setView("day");
            }}
          />
        )}
      </div>

      <TimeOffDialog
        open={timeOffOpen}
        onOpenChange={setTimeOffOpen}
        techIds={techIds}
        users={users}
        defaultDate={date}
      />
      <RescheduleConfirmDialog
        target={pending}
        users={users}
        conflicts={pendingConflicts}
        onConfirm={() => {
          if (pending) reschedule.mutate(pending);
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
