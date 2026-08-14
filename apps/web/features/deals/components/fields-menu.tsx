"use client";

import { useState } from "react";
import { Columns3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { jobFieldOptions } from "../fields";
import { useJobFieldsStore } from "../fields-store";

/**
 * Workiz-style "Visible fields" panel: every deal field — custom fields
 * included — can be toggled into the Jobs table. Searchable, grouped into
 * used (checked) and unselected.
 */
export function FieldsMenu() {
  const visible = useJobFieldsStore((s) => s.visible);
  const toggle = useJobFieldsStore((s) => s.toggle);
  const { data: customFieldDefs } = useCustomFields();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const options = jobFieldOptions(customFieldDefs).filter(
    (f) => !q || f.label.toLowerCase().includes(q),
  );
  const used = options.filter((f) => visible[f.id]);
  const unselected = options.filter((f) => !visible[f.id]);

  const group = (title: string, items: { id: string; label: string }[]) =>
    items.length ? (
      <div className="space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
        {items.map((f) => (
          <label
            key={f.id}
            className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm hover:bg-muted/40"
          >
            <Checkbox checked={Boolean(visible[f.id])} onCheckedChange={() => toggle(f.id)} />
            {f.label}
          </label>
        ))}
      </div>
    ) : null;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <Columns3 className="size-4" /> Fields
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[90vw] gap-0 sm:max-w-sm">
        <SheetHeader className="pb-2">
          <SheetTitle>Visible fields</SheetTitle>
        </SheetHeader>

        {/* Search stays pinned; only the field list below scrolls. */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              placeholder="Search fields…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
          {group("Used fields", used)}
          {group("Unselected fields", unselected)}
          {used.length === 0 && unselected.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fields match your search.</p>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
