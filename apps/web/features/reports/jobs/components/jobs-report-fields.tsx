"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { JOBS_REPORT_COLUMNS, type JobsReportColumnId } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { inReportOrder } from "../lib";

/**
 * Workiz's "Visible fields" side panel: a search box, every column with a
 * tick, Cancel / Save fields. Saving is the account's (Workiz keeps
 * `jobReportSettings` per account) and needs `reports.edit`; without it the
 * choice applies to this screen only. At least one column stays ticked.
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
  /** Without `financials.view` there is no Total to show. */
  money: boolean;
  canSave: boolean;
  saving?: boolean;
  onApply: (columns: JobsReportColumnId[], persist: boolean) => void;
}) {
  const [draft, setDraft] = useState<JobsReportColumnId[]>(columns);
  const [query, setQuery] = useState("");

  const available = JOBS_REPORT_COLUMNS.filter((c) => money || c.id !== "total");
  const needle = query.trim().toLowerCase();
  const shown = needle ? available.filter((c) => c.label.toLowerCase().includes(needle)) : available;
  const toggle = (id: JobsReportColumnId) =>
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
