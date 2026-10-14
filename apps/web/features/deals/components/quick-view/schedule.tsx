"use client";

import { useState } from "react";
import { WzCheckbox, WzDateField, WzSwitch, WzTimeSelect } from "@/components/workiz";
import type { Deal } from "@bitcrm/types";
import { toast } from "sonner";
import { useUpdateDeal } from "../../hooks";
import type { UpdateDealValues } from "../../schemas";
import { slotTimes, withAllDay, withEndTime, withScheduled, withStartTime, type ScheduledValue } from "../scheduled-block";
import { labelled, workizScheduleCell } from "../../schedule-cell";
import { DEFAULT_TZ } from "@/lib/timezone";
import { QvButtons, QvIconButton, QvTitle } from "./parts";

const valueOf = (deal: Deal): ScheduledValue => ({
  date: deal.scheduledDate ?? "",
  endDate: deal.scheduledEndDate ?? deal.scheduledDate ?? "",
  slot: deal.allDay ? "" : (deal.scheduledTimeSlot ?? ""),
  allDay: !!deal.allDay,
});

/** The visit as a PUT body: the day, its end, the times unless all-day. */
export function schedulePatch(v: ScheduledValue): UpdateDealValues {
  if (!v.date) return { scheduledDate: null };
  return {
    scheduledDate: v.date,
    scheduledEndDate: v.endDate || v.date,
    allDay: v.allDay,
    ...(v.allDay ? {} : { scheduledTimeSlot: v.slot }),
  };
}

/**
 * The visit as the jobs list prints it (audit L18): "Mon Nov 16, 2026 04:30 pm
 * EST" on the account's (Connecticut's) clock, then — when the job keeps its
 * own zone — the place and its own clock, each naming its zone.
 */
function Visit({ deal, zone }: { deal: Deal; zone: string | undefined }) {
  const c = workizScheduleCell(
    {
      scheduledDate: deal.scheduledDate,
      scheduledTimeSlot: deal.allDay ? undefined : deal.scheduledTimeSlot,
      city: deal.address?.city,
      zone,
    },
    DEFAULT_TZ,
  );
  return (
    <div className="text-[14px] leading-[19px] text-[#3b4b52]">
      <div>{labelled(c.when, c.abbr)}</div>
      {c.area ? <div className="text-[12px] leading-4 text-[#566d76]">{`${c.area.place}: ${labelled(c.area.when, c.area.abbr)}`}</div> : null}
    </div>
  );
}

/**
 * Workiz's "Schedule job" (quickview_wz_edit_schedule): the title, a pencil,
 * the switch at the right; the visit under it — or "This job is unscheduled".
 * The pencil opens Starts / At, Ends / At in two 188px columns, All day, then
 * Cancel / Save. The switch applies at once: off unschedules, on books from
 * now in the job's zone, as the job page's does.
 */
export function ScheduleJobBlock({ deal, zone, canEdit }: { deal: Deal; zone: string | undefined; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const [draft, setDraft] = useState<ScheduledValue | null>(null);
  const tz = zone ?? DEFAULT_TZ;
  const scheduled = !!deal.scheduledDate;
  const [start, end] = draft ? slotTimes(draft.slot) : ["", ""];

  const save = () => {
    if (!draft) return;
    update.mutate(schedulePatch(draft), { onSuccess: () => setDraft(null) });
  };
  const toggle = (on: boolean) => {
    const next = withScheduled(valueOf(deal), on, tz);
    update.mutate(schedulePatch(next), { onSuccess: () => toast.success(on ? "Job scheduled" : "Job unscheduled") });
  };

  return (
    <section aria-label="Schedule job" className="px-6 pt-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <QvTitle>Schedule job</QvTitle>
          {canEdit ? <QvIconButton label="Edit schedule" icon="pencil" active={!!draft} onClick={() => setDraft(draft ? null : valueOf(deal))} /> : null}
        </div>
        <WzSwitch aria-label="Schedule job" checked={scheduled} disabled={!canEdit || update.isPending} onCheckedChange={toggle} />
      </div>
      {draft ? (
        <div className="mt-[14px]">
          <div className="grid grid-cols-[188px_188px] gap-x-4 gap-y-6">
            <WzDateField label="Starts" value={draft.date} onChange={(date) => setDraft({ ...draft, date })} />
            {draft.allDay ? <span /> : <WzTimeSelect label="At" value={start} onChange={(t) => setDraft(withStartTime(draft, t))} />}
            <WzDateField label="Ends" min={draft.date || undefined} value={draft.endDate || draft.date} onChange={(endDate) => setDraft({ ...draft, endDate })} />
            {draft.allDay ? <span /> : <WzTimeSelect label="At" value={end} onChange={(t) => setDraft(withEndTime(draft, t))} />}
          </div>
          <WzCheckbox className="mt-5" label="All day" checked={draft.allDay} onCheckedChange={(on) => setDraft(withAllDay(draft, on))} />
          <QvButtons className="mt-3" onCancel={() => setDraft(null)} onSave={save} saving={update.isPending} saveDisabled={!draft.date} />
        </div>
      ) : scheduled ? (
        <div className="mt-2">
          <Visit deal={deal} zone={zone} />
        </div>
      ) : (
        <p className="mt-2 text-[14px] leading-[19px] text-[#566d76]">This job is unscheduled</p>
      )}
    </section>
  );
}
