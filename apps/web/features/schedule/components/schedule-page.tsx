"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import * as dealApi from "@/features/deals/api";
import { personName } from "@/features/deals/person-name";
import {
  localMinutes,
  localTodayISO,
  scheduleColor,
  stepDate,
  viewRange,
  weekOf,
  type ScheduleView,
} from "../calendar";
import { buildEntries } from "../entries";
import { applyScheduleFilter, pickedTechIds, type SchedulePick } from "../filters";
import { dealConflicts, eventOnDate, filterTechnicians, type ConflictReason } from "../lib";
import { moveBody, nextTechIds, resolveDrop, scheduleBody, type DragSource, type DropZone } from "../reschedule";
import { useScheduleBoard, type ScheduleBoard } from "../use-schedule-board";
import { MonthGrid } from "./month-grid";
import { RescheduleConfirmDialog, type RescheduleTarget } from "./reschedule-confirm-dialog";
import { ScheduleFilter } from "./schedule-filter";
import { ScheduleToolbar } from "./schedule-toolbar";
import { TimeGrid } from "./time-grid";
import { TimelineGrid, type TimelineRow } from "./timeline-grid";
import { TimeOffDialog } from "./time-off-dialog";
import { UnscheduledPane } from "./unscheduled-pane";

/** Before the first calendar is in: nothing to draw yet. */
const NO_BOARD: ScheduleBoard = {
  view: "day",
  date: "",
  deals: [],
  unscheduled: [],
  events: [],
  contacts: new Map(),
  profiles: [],
  users: new Map(),
  jobTypes: new Map(),
  activeJobTypes: [],
  areas: [],
  areaColors: new Map(),
  roles: new Map(),
};

/** The browser's clock, in minutes since midnight, ticking each minute (the Timeline's red line). */
function useNowMinutes(): number {
  const [now, setNow] = useState(() => localMinutes());
  useEffect(() => {
    const id = setInterval(() => setNow(localMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * The Schedule — Workiz's `/root/schedule/` (pg_schedule_wz_*): Day, Week,
 * Month, Timeline and Timeline Week over the jobs of the days on screen, the
 * "Unscheduled jobs" pane, "Filter results", and Add time off. Ours on top:
 * a drop asks before it saves and warns of clashes; the calendar keeps itself
 * current (live stream, else polling) and appears whole, once.
 */
export function SchedulePage() {
  const router = useRouter();
  const { can } = usePermissions();
  const denied = useDenied();
  const qc = useQueryClient();
  const [view, setView] = useState<ScheduleView>("day");
  const [date, setDate] = useState(() => localTodayISO());
  const [filterOpen, setFilterOpen] = useState(false);
  const [picks, setPicks] = useState<SchedulePick[]>([]);
  const [paneOpen, setPaneOpen] = useState(false);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  const [pending, setPending] = useState<RescheduleTarget | null>(null);
  const [scrollHour] = useState(() => new Date().getHours());
  const nowMin = useNowMinutes();
  const today = localTodayISO();

  const canView = can("deals", "view");
  const canManage = can("technicians", "edit");
  const readOnly = !canManage;

  const { board } = useScheduleBoard({ view, date }, canView);
  const b = board ?? NO_BOARD;

  const techName = useCallback((id: string) => personName(b.users.get(id)) ?? "", [b.users]);
  const jobTypeName = useCallback((id: string) => b.jobTypes.get(id) ?? "", [b.jobTypes]);

  // The field team, active, as the Timeline's rows and the TEAM filter.
  const roster = useMemo(() => filterTechnicians(b.profiles, b.users, { activeOnly: true }), [b.profiles, b.users]);
  const team = useMemo(() => roster.map((p) => ({ id: p.userId, name: techName(p.userId) })).filter((t) => t.name), [roster, techName]);
  const picked = useMemo(() => pickedTechIds(picks), [picks]);
  const profileMap = useMemo(() => new Map(b.profiles.map((p) => [p.userId, p])), [b.profiles]);

  const entries = useMemo(() => {
    const deals = applyScheduleFilter(b.deals, picks);
    const events = b.events.filter((e) => !picked || picked.includes(e.technicianId));
    return buildEntries(deals, events, {
      jobTypeName,
      techName,
      profiles: profileMap,
      areaColor: (name) => b.areaColors.get(name),
    });
  }, [b.deals, b.events, b.areaColors, picks, picked, jobTypeName, techName, profileMap]);

  const rows = useMemo<TimelineRow[]>(() => {
    const row = (id: string, p?: (typeof roster)[number]): TimelineRow => {
      const user = b.users.get(id) as ({ roleId?: string } & object) | undefined;
      return {
        id,
        name: techName(id) || "—",
        role: user?.roleId ? b.roles.get(user.roleId) : undefined,
        color: scheduleColor(id),
        photoUrl: p?.profilePhotoUrl,
        hours: p,
      };
    };
    const shown = (id: string) => !picked || picked.includes(id);
    const techRows = roster.filter((p) => shown(p.userId)).map((p) => row(p.userId, p));
    // Someone off the roster (inactive, off the field team) who still has a job on
    // these days keeps a row, so the job does not drop off the Timeline.
    const onRoster = new Set(roster.map((p) => p.userId));
    const extra = [...new Set(entries.filter((e) => e.kind === "job").flatMap((e) => e.techIds))]
      .filter((id) => !onRoster.has(id) && shown(id))
      .map((id) => row(id, profileMap.get(id)));
    const all = [...techRows, ...extra];
    return picked ? all : [{ id: null, name: "Unassigned", color: "" }, ...all];
  }, [roster, picked, entries, profileMap, b.users, b.roles, techName]);

  const openJob = useCallback((deal: Deal) => router.push(`/deals/${deal.id}`), [router]);
  const pickDay = useCallback((d: string) => {
    setDate(d);
    setView("day");
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const source = e.active.data.current as DragSource | undefined;
    if (!source || readOnly) return;
    const zone = (e.over?.data.current ?? null) as DropZone | null;
    const start = e.activatorEvent as MouseEvent | null;
    const pointer = start && "clientX" in start ? { x: start.clientX + e.delta.x, y: start.clientY + e.delta.y } : null;
    const rect = e.over ? { top: e.over.rect.top, left: e.over.rect.left } : null;
    const drop = resolveDrop(source, zone, e.delta, pointer, rect);
    if (!drop) return;
    const scheduling = source.kind === "card";
    setPending({
      deal: source.deal,
      body: scheduling ? scheduleBody(drop.date, drop.startMin) : moveBody(source.deal, drop),
      fromTechId: "fromTechId" in source ? source.fromTechId : scheduling && drop.techId !== undefined ? null : undefined,
      toTechId: drop.techId,
      scheduling,
    });
  };

  const reschedule = useMutation({
    mutationFn: async (t: RescheduleTarget) => {
      await dealApi.updateDeal(t.deal.id, t.body as never);
      if (t.toTechId !== undefined && t.toTechId !== t.fromTechId) {
        // Swap just the technician of the row it left; the rest of the crew stays on the job.
        await dealApi.assignTechs(t.deal.id, nextTechIds(t.deal.assignedTechIds, t.fromTechId ?? null, t.toTechId));
      }
    },
    onSuccess: (_r, t) => {
      qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      toast.success(t.scheduling ? "Job scheduled" : "Job rescheduled");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  // Clashes of the waiting drop, worked out against what is on screen.
  const pendingConflicts: ConflictReason[] = useMemo(() => {
    if (!pending) return [];
    const techs =
      pending.toTechId !== undefined && pending.toTechId !== pending.fromTechId
        ? nextTechIds(pending.deal.assignedTechIds, pending.fromTechId ?? null, pending.toTechId)
        : pending.deal.assignedTechIds;
    const preview: Deal = { ...pending.deal, ...pending.body, assignedTechIds: techs };
    const reasons = new Set<ConflictReason>();
    for (const tech of techs) {
      const sameDay = b.deals.filter(
        (d) => d.id !== preview.id && d.scheduledDate === preview.scheduledDate && d.assignedTechIds.includes(tech),
      );
      const techEvents = b.events.filter(
        (e) => e.technicianId === tech && preview.scheduledDate && eventOnDate(e, preview.scheduledDate),
      );
      for (const r of dealConflicts(preview, sameDay, techEvents, profileMap.get(tech) ?? {})) reasons.add(r);
    }
    return [...reasons];
  }, [pending, b.deals, b.events, profileMap]);

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

  const scrollKey = board?.view ?? "";
  const shownView = board?.view ?? view;
  const shownDate = board?.date ?? date;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white pt-[14px]">
      {filterOpen ? <ScheduleFilter techs={team} jobTypes={b.activeJobTypes} areas={b.areas} value={picks} onChange={setPicks} /> : null}
      <ScheduleToolbar
        view={view}
        date={date}
        onView={setView}
        onToday={() => setDate(localTodayISO())}
        onStep={(dir) => setDate((d) => stepDate(view, d, dir))}
        unscheduledCount={board ? board.unscheduled.length : undefined}
        unscheduledOpen={paneOpen}
        onToggleUnscheduled={() => setPaneOpen((o) => !o)}
        onAddTimeOff={canManage ? () => setTimeOffOpen(true) : undefined}
        filterOpen={filterOpen}
        onToggleFilter={() => setFilterOpen((o) => !o)}
      />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col pt-[3px]">
            {!board ? (
              <Skeleton className="m-4 flex-1 rounded-[4px]" />
            ) : shownView === "day" || shownView === "week" ? (
              <TimeGrid
                days={shownView === "day" ? [shownDate] : weekOf(shownDate)}
                today={today}
                entries={entries}
                readOnly={readOnly}
                scrollKey={scrollKey}
                scrollHour={scrollHour}
                onOpen={openJob}
                onPickDay={shownView === "week" ? pickDay : undefined}
              />
            ) : shownView === "month" ? (
              <MonthGrid date={shownDate} entries={entries} readOnly={readOnly} onOpen={openJob} onPickDay={pickDay} />
            ) : (
              <TimelineGrid
                mode={shownView === "timeline" ? "day" : "week"}
                date={shownDate}
                days={weekOf(shownDate)}
                today={today}
                nowMin={nowMin}
                rows={rows}
                entries={entries}
                readOnly={readOnly}
                scrollKey={scrollKey}
                scrollHour={scrollHour}
                onOpen={openJob}
              />
            )}
          </div>
          {paneOpen && board ? (
            <UnscheduledPane
              deals={board.unscheduled}
              contacts={board.contacts}
              jobTypeName={jobTypeName}
              techColor={scheduleColor}
              readOnly={readOnly}
              onOpen={openJob}
              onClose={() => setPaneOpen(false)}
            />
          ) : null}
        </div>
      </DndContext>

      <TimeOffDialog
        // A fresh form, with the next half hour, every time it opens.
        key={timeOffOpen ? "time-off-open" : "time-off-closed"}
        open={timeOffOpen}
        onOpenChange={setTimeOffOpen}
        techIds={roster.map((p) => p.userId)}
        users={b.users}
        defaultDate={viewRange(view, date).from <= today && today <= viewRange(view, date).to ? today : date}
      />
      <RescheduleConfirmDialog
        target={pending}
        users={b.users}
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
