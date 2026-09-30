"use client";

import { useId } from "react";
import { ChevronsUpDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { locationHint, type StockLocation } from "../lib";

/**
 * A searchable select over warehouses and vans. A plain select is fine for a
 * handful and unusable for a fleet of ninety, so the list filters by name,
 * technician and department — how dispatch actually names a van ("Taras's",
 * "the North one").
 *
 * `open` is the caller's so the dialog around it can close the list on Escape
 * instead of closing itself.
 */
export function LocationPicker({
  labelId,
  groups,
  value,
  onChange,
  open,
  onOpenChange,
  loading,
}: {
  labelId: string;
  groups: { warehouses: StockLocation[]; containers: StockLocation[] };
  value: StockLocation | null;
  onChange: (location: StockLocation) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
}) {
  const empty = groups.warehouses.length === 0 && groups.containers.length === 0;
  const listId = useId();

  return (
    <div className="relative">
      <button
        type="button"
        role="combobox"
        aria-labelledby={labelId}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        onClick={() => onOpenChange(!open)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        <span className={cn("truncate", !value && "text-muted-foreground")}>
          {value ? value.name : "Pick a location"}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open ? (
        <>
          {/* Inside the dialog a click anywhere else closes the list; outside
              it the dialog's own dismissal takes over. */}
          <div aria-hidden className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} />
          <div
            id={listId}
            className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-lg border bg-popover shadow-md"
          >
            <Command loop>
              <CommandInput autoFocus placeholder="Search locations" className="h-9" />
              <CommandList className="max-h-60">
                {loading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">Loading locations…</div>
                ) : empty ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No other locations.</div>
                ) : (
                  <>
                    <CommandEmpty>No location matches.</CommandEmpty>
                    <Group heading="Warehouses" locations={groups.warehouses} value={value} onPick={onChange} />
                    <Group heading="Containers" locations={groups.containers} value={value} onPick={onChange} />
                  </>
                )}
              </CommandList>
            </Command>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Group({
  heading,
  locations,
  value,
  onPick,
}: {
  heading: string;
  locations: StockLocation[];
  value: StockLocation | null;
  onPick: (location: StockLocation) => void;
}) {
  if (locations.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {locations.map((l) => {
        const hint = locationHint(l);
        const picked = value?.type === l.type && value.id === l.id;
        return (
          <CommandItem
            key={`${l.type}:${l.id}`}
            // Unique per location (a warehouse and a van may share an id);
            // the words people search by go in as keywords.
            value={`${l.type}:${l.id}`}
            keywords={[l.name, hint, l.description ?? ""]}
            onSelect={() => onPick(l)}
            data-checked={picked ? "true" : undefined}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{l.name}</span>
              {hint ? (
                <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
              ) : null}
            </span>
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
