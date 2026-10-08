"use client";

import { useId, useState, type ReactNode } from "react";
import { BarChart3, CalendarDays, CircleDollarSign, Diamond, Mail, MapPin, Phone, Tag, Users, Wrench } from "lucide-react";
import { JOBS_REPORT_COLUMNS, type JobsReportColumnId } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WzDrawer } from "@/components/workiz/drawer";
import { WzSearchBox } from "@/components/workiz/toolbar";

/** Workiz's panel glyph per field (its `wfi-*` map in the report's bundle), as their nearest lucide twins. */
type FieldIcon = "job" | "users" | "tag" | "calendar" | "phone" | "email" | "diamond" | "location" | "money" | "source";

const ICONS: Record<FieldIcon, ReactNode> = {
  job: <Wrench />,
  users: <Users />,
  tag: <Tag />,
  calendar: <CalendarDays />,
  phone: <Phone />,
  email: <Mail />,
  diamond: <Diamond />,
  location: <MapPin />,
  money: <CircleDollarSign />,
  source: <BarChart3 />,
};

/** "Metro Area" is not in Workiz's map under that name, so it gets the default glyph (rep_jobs_wz_10_fields_scroll1). */
const FIELD_ICON: Record<JobsReportColumnId, FieldIcon> = {
  jobNumber: "job",
  jobName: "job",
  client: "users",
  tags: "tag",
  type: "job",
  created: "calendar",
  scheduled: "calendar",
  end: "calendar",
  phone: "phone",
  email: "email",
  status: "diamond",
  tech: "users",
  createdBy: "users",
  address: "location",
  city: "location",
  state: "location",
  zip: "location",
  serviceArea: "diamond",
  total: "money",
  source: "source",
  externalCompany: "diamond",
  leadCreated: "calendar",
  origin: "diamond",
};

const FIELDS = JOBS_REPORT_COLUMNS.map((c) => ({ id: c.id as JobsReportColumnId, label: c.label as string }));

/** The chosen columns in the report's fixed order (Workiz does not reorder). */
const inReportOrder = (ids: readonly JobsReportColumnId[]) => FIELDS.map((f) => f.id).filter((id) => ids.includes(id));

/**
 * Workiz's "Visible fields" panel on the Jobs report (rep_jobs_wz_10_fields_open,
 * _10_fields_scroll1): the 422px drawer, "Search fields" and its box held at
 * the top, then USED FIELDS — the report's columns in their fixed order — and
 * UNSELECTED FIELDS; a tick moves a field between the two. Rows 354×42, 1px
 * #dfe2e3, 8px corners, 8px apart: the tick, the name 14px/500, the field's
 * glyph at the right. No drag handles (Workiz's report does not reorder).
 * "Save fields" keeps the choice for the account (`reports.edit`); without
 * that grant the button reads "Apply" and the choice is this screen's only.
 * At least one field stays ticked.
 */
export function JobsReportFields({
  open,
  onOpenChange,
  columns,
  money,
  canSave,
  saving,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: JobsReportColumnId[];
  /** Without `financials.view` there are no amounts to show. */
  money: boolean;
  canSave: boolean;
  saving?: boolean;
  onApply: (columns: JobsReportColumnId[], persist: boolean) => void;
}) {
  const [draft, setDraft] = useState<JobsReportColumnId[]>(columns);
  const [query, setQuery] = useState("");
  const usedId = useId();
  const unusedId = useId();

  const available = FIELDS.filter((f) => money || f.id !== "total");
  const needle = query.trim().toLowerCase();
  const shown = needle ? available.filter((f) => f.label.toLowerCase().includes(needle)) : available;
  const used = shown.filter((f) => draft.includes(f.id));
  const unused = shown.filter((f) => !draft.includes(f.id));
  const none = !draft.some((id) => available.some((f) => f.id === id));

  const toggle = (id: JobsReportColumnId) =>
    setDraft((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : inReportOrder([...cur, id])));

  return (
    <WzDrawer
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from what the report shows now.
        if (next) {
          setDraft(columns);
          setQuery("");
        }
        onOpenChange(next);
      }}
      title="Visible fields"
      bodyClassName="flex flex-col overflow-hidden p-0"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={none || saving} onClick={() => onApply(inReportOrder(draft), canSave)}>
            {canSave ? (saving ? "Saving…" : "Save fields") : "Apply"}
          </Button>
        </>
      }
    >
      <div className="shrink-0 px-6 pt-6">
        <h5 className="text-base leading-6 font-medium tracking-[0.2px] text-foreground">Search fields</h5>
        <WzSearchBox
          value={query}
          onChange={setQuery}
          placeholder="Type field name here"
          aria-label="Search fields"
          className="w-full"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-2">
        {used.length ? (
          <section aria-labelledby={usedId} className="mb-4">
            <h6 id={usedId} className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-wz-outline uppercase">
              Used fields
            </h6>
            {used.map((f) => (
              <FieldRow key={f.id} id={f.id} label={f.label} checked onToggle={() => toggle(f.id)} />
            ))}
          </section>
        ) : null}
        {unused.length ? (
          <section aria-labelledby={unusedId} className="mb-4">
            <h6 id={unusedId} className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-wz-outline uppercase">
              Unselected fields
            </h6>
            {unused.map((f) => (
              <FieldRow key={f.id} id={f.id} label={f.label} checked={false} onToggle={() => toggle(f.id)} />
            ))}
          </section>
        ) : null}
        {!used.length && !unused.length ? <p className="text-sm text-wz-caption">No fields match your search.</p> : null}
        {none ? (
          <p role="alert" className="text-xs text-destructive">
            At least one field must be selected.
          </p>
        ) : null}
      </div>
    </WzDrawer>
  );
}

/** One field: 354×42, 1px #dfe2e3, 8px corners; the tick 11px in, the name 13px after it, the glyph at the right. */
function FieldRow({ id, label, checked, onToggle }: { id: JobsReportColumnId; label: string; checked: boolean; onToggle: () => void }) {
  return (
    <div className="mb-2 flex h-[42px] w-full max-w-[354px] items-center gap-2 rounded-[8px] border border-border bg-background pr-2 pl-[10px]">
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-[13px]">
        <Checkbox aria-label={label} checked={checked} onCheckedChange={onToggle} />
        <span className="truncate text-sm leading-[21px] font-medium tracking-[0.4px] text-foreground">{label}</span>
      </label>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-foreground [&_svg]:size-4 [&_svg]:stroke-[1.5]">
        {ICONS[FIELD_ICON[id]]}
      </span>
    </div>
  );
}
