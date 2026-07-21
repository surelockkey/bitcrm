"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ZipRow {
  zip: string;
  radiusMiles?: number | "";
}

/**
 * Edits the "list of ZIP codes (each optionally +N miles)" area type. A single
 * row is the "ZIP + N miles" case; many rows are the list case — same shape.
 */
export function ZipListEditor({
  value,
  onChange,
}: {
  value: ZipRow[];
  onChange: (rows: ZipRow[]) => void;
}) {
  const update = (i: number, patch: Partial<ZipRow>) =>
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { zip: "", radiusMiles: "" }]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[2fr_1.5fr_auto] items-center gap-2">
        <Label className="text-xs text-muted-foreground">ZIP code</Label>
        <Label className="text-xs text-muted-foreground">+ miles (optional)</Label>
        <span />
      </div>
      {value.map((row, i) => (
        <div key={i} className="grid grid-cols-[2fr_1.5fr_auto] items-center gap-2">
          <Input
            className="h-9"
            placeholder="30301"
            value={row.zip}
            onChange={(e) => update(i, { zip: e.target.value })}
          />
          <Input
            className="h-9"
            type="number"
            min={0}
            placeholder="e.g. 10"
            value={row.radiusMiles ?? ""}
            onChange={(e) =>
              update(i, { radiusMiles: e.target.value === "" ? "" : Number(e.target.value) })
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={() => remove(i)}
            aria-label="Remove ZIP"
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={add}>
        <Plus className="size-3.5" /> Add ZIP code
      </Button>
    </div>
  );
}
