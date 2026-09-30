"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { JOBS_REPORT_COLUMNS, type JobsReportColumnId } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** A column the panel offers: its id, its header, and whether it is an amount (hidden without money). */
export interface FieldOption<C extends string> {
  id: C;
  label: string;
  money?: boolean;
}

/** The Jobs report's columns — Total is its only amount. */
const JOBS_FIELDS: readonly FieldOption<JobsReportColumnId>[] = JOBS_REPORT_COLUMNS.map((c) => ({
  id: c.id,
  label: c.label,
  money: c.id === "total",
}));

/**
 * Workiz's "Visible fields" side panel: a search box, every column with a
 * tick, Cancel / Save fields. Saving is the account's (Workiz keeps
 * `jobReportSettings` per account) and needs `reports.edit`; without it the
 * choice applies to this screen only. At least one column stays ticked.
 * Another report passes its own `fields` (the Sales report's twenty-three).
 */
export function JobsReportFields<C extends string = JobsReportColumnId>({
  open,
  onOpenChange,
  columns,
  money,
  canSave,
  saving,
  onApply,
  fields = JOBS_FIELDS as unknown as readonly FieldOption<C>[],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: C[];
  /** Without `financials.view` there are no amounts to show. */
  money: boolean;
  canSave: boolean;
  saving?: boolean;
  onApply: (columns: C[], persist: boolean) => void;
  /** The report's columns in its fixed order. Default: the Jobs report's. */
  fields?: readonly FieldOption<C>[];
}) {
  const [draft, setDraft] = useState<C[]>(columns);
  const [query, setQuery] = useState("");
  // The report's fixed order (Workiz does not reorder).
  const inReportOrder = (ids: readonly C[]): C[] => fields.map((f) => f.id).filter((id) => ids.includes(id));

  const available = fields.filter((c) => money || !c.money);
  const needle = query.trim().toLowerCase();
  const shown = needle ? available.filter((c) => c.label.toLowerCase().includes(needle)) : available;
  const toggle = (id: C) =>
    setDraft((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : inReportOrder([...cur, id])));
  const none = !draft.some((c) => available.some((a) => a.id === c));

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Every opening starts from what the report shows now.
        if (next) {
          setDraft(columns);
          setQuery("");
        }
        onOpenChange(next);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Visible fields</SheetTitle>
          <SheetDescription>{canSave ? "Saved for everyone in the account." : "Applies to this screen only."}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4">
          <label className="text-sm font-medium" htmlFor="jobs-report-fields-search">
            Search fields
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="jobs-report-fields-search"
              className="pl-8"
              placeholder="Type field name here"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Used fields</p>
          <ul className="-mx-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1 pb-2">
            {shown.map((c) => {
              const id = `jobs-report-field-${c.id}`;
              return (
                <li key={c.id}>
                  <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                    <Checkbox id={id} checked={draft.includes(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span>{c.label}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          {none ? (
            <p role="alert" className="text-xs text-destructive">
              At least one field must be selected.
            </p>
          ) : null}
        </div>
        <SheetFooter className="flex-row justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={none || saving} onClick={() => onApply(inReportOrder(draft), canSave)}>
            {canSave ? (saving ? "Saving…" : "Save fields") : "Apply"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
