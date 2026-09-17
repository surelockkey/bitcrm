"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NotConnectedField as FieldSpec } from "../not-connected";

/**
 * A Workiz field we have no data for, drawn in its place and visibly dead.
 *
 * Every control is really `disabled` — not styled to look it — so it is out of
 * the tab order and answers no click, and each is tied to its own line of
 * explanation with `aria-describedby`, so someone hearing the page is told why
 * the control is dead at the moment they reach it rather than a screen later.
 *
 * `static` fields have no control at all: a multi-select or a colour swatch
 * with nothing behind it is a picture of a value, and a disabled empty box says
 * the same thing more honestly.
 */
export function NotConnectedField({ field }: { field: FieldSpec }) {
  const noteId = useId();
  const labelId = useId();

  return (
    <div className="space-y-1.5" data-testid={`not-connected-${field.key}`}>
      {field.kind === "switch" ? (
        <div className="flex items-center justify-between gap-3">
          <span id={labelId} className="text-sm font-medium text-muted-foreground">
            {field.label}
          </span>
          <Switch checked={false} disabled aria-labelledby={labelId} aria-describedby={noteId} />
        </div>
      ) : (
        <>
          <Label className="text-muted-foreground" id={labelId}>
            {field.label}
          </Label>
          <Control field={field} labelId={labelId} noteId={noteId} />
        </>
      )}
      <p id={noteId} className="text-xs text-muted-foreground">
        {field.note}
      </p>
    </div>
  );
}

function Control({
  field,
  labelId,
  noteId,
}: {
  field: FieldSpec;
  labelId: string;
  noteId: string;
}) {
  switch (field.kind) {
    case "text":
      return <Input className="h-10" value="" readOnly disabled aria-labelledby={labelId} aria-describedby={noteId} />;
    case "textarea":
      return <Textarea rows={3} value="" readOnly disabled aria-labelledby={labelId} aria-describedby={noteId} />;
    case "select":
      return (
        <Select disabled>
          <SelectTrigger className="h-10 w-full" aria-labelledby={labelId} aria-describedby={noteId}>
            <SelectValue placeholder="—" />
          </SelectTrigger>
          {/* Never opens: a disabled trigger can't, and there is nothing to list. */}
          <SelectContent />
        </Select>
      );
    case "static":
      return (
        <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">—</div>
      );
  }
}
