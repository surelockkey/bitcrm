"use client";

import { useState } from "react";
import { CalendarEventType } from "@bitcrm/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WzButton, WzCheckbox, WzDateField, WzOutlinedSelect, WzTimeSelect } from "@/components/workiz";
import { useCreateCalendarEvent } from "../hooks";
import { calendarEventSchema, toEventInput } from "../schemas";
import { eventLabel } from "../lib";
import type { DirectoryUser } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";

const TYPES = [
  CalendarEventType.TIME_OFF,
  CalendarEventType.LUNCH,
  CalendarEventType.BREAK,
  CalendarEventType.APPOINTMENT,
];

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The next half hour by the browser's clock and an hour after it, as Workiz fills Starts / Ends. */
function defaultTimes(now = new Date()): { start: string; end: string } {
  const next = Math.min(Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30, 23 * 60);
  return { start: hhmm(next), end: hhmm(Math.min(next + 60, 23 * 60 + 45)) };
}

/**
 * Workiz's "Add time off" (pg_schedule_wz_13_timeoff_open): a 440px modal —
 * Select user, Reason, Starts / At, Ends / At, All-day event, Add a note,
 * then Cancel and the yellow "Add time off". Our calendar events behind it:
 * a timed one is a single day; an all-day one may run over several; the note
 * is the event's title (the reason's name when left empty).
 */
export function TimeOffDialog({
  open,
  onOpenChange,
  techIds,
  users,
  defaultTechId,
  defaultDate,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  techIds: string[];
  users: Map<string, DirectoryUser>;
  defaultTechId?: string;
  defaultDate: string;
}) {
  const create = useCreateCalendarEvent();
  const [times] = useState(defaultTimes);
  const [techId, setTechId] = useState(defaultTechId ?? "");
  const [type, setType] = useState<CalendarEventType | "">("");
  const [startDate, setStartDate] = useState(defaultDate);
  const [startTime, setStartTime] = useState(times.start);
  const [endDate, setEndDate] = useState(defaultDate);
  const [endTime, setEndTime] = useState(times.end);
  const [allDay, setAllDay] = useState(false);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ tech?: string; type?: string; form?: string }>({});

  const userOptions = techIds.map((id) => ({ value: id, label: personName(users.get(id)) ?? "…" }));
  const typeOptions = TYPES.map((t) => ({ value: t, label: eventLabel(t) }));

  const submit = () => {
    const next: typeof errors = {};
    if (!techId) next.tech = "Pick a technician";
    if (!type) next.type = "Pick a reason";
    if (next.tech || next.type) return setErrors(next);
    const parsed = calendarEventSchema.safeParse({
      type,
      title: note.trim() || eventLabel(type as CalendarEventType),
      startDate,
      endDate,
      allDay,
      timeSlot: allDay ? "" : `${startTime}-${endTime}`,
    });
    if (!parsed.success) return setErrors({ form: parsed.error.issues[0]?.message ?? "Check the form" });
    setErrors({});
    create.mutate({ techId, body: toEventInput(parsed.data) }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add time off</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-6 pt-2">
          <WzOutlinedSelect
            label="Select user"
            placeholder="Select user"
            options={userOptions}
            value={techId}
            onChange={setTechId}
            error={errors.tech}
          />
          <WzOutlinedSelect
            label="Reason"
            options={typeOptions}
            value={type}
            onChange={(v) => setType(v as CalendarEventType)}
            error={errors.type}
          />
          <div className="grid grid-cols-2 gap-x-4 gap-y-6">
            <WzDateField label="Starts" value={startDate} onChange={(d) => {
              setStartDate(d);
              if (endDate < d) setEndDate(d);
            }} />
            <WzTimeSelect label="At" value={startTime} onChange={setStartTime} disabled={allDay} />
            <WzDateField label="Ends" min={startDate} value={endDate} onChange={setEndDate} />
            <WzTimeSelect label="At" value={endTime} onChange={setEndTime} disabled={allDay} />
          </div>
          <WzCheckbox label="All-day event" checked={allDay} onCheckedChange={setAllDay} className="-mt-3" />
          <textarea
            aria-label="Add a note"
            placeholder="Add a note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="h-[55px] w-full rounded-[4px] border border-wz-outline bg-white px-3 py-[10.5px] text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link"
          />
          {errors.form ? <p className="-mt-3 text-[12px] text-wz-error">{errors.form}</p> : null}
          <div className="flex justify-end gap-4 pt-[12px]">
            <WzButton variant="tertiary" size="regular" onClick={() => onOpenChange(false)}>
              Cancel
            </WzButton>
            <WzButton variant="primary" size="regular" loading={create.isPending} onClick={submit}>
              Add time off
            </WzButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
