"use client";

import { useId } from "react";
import { ChevronsUpDown } from "lucide-react";
import { Popover } from "radix-ui";
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
  hint = locationHint,
  placeholder = "Pick a location",
  searchPlaceholder = "Search locations",
  emptyText = "No other locations.",
  disabled = false,
}: {
  labelId: string;
  groups: { warehouses: StockLocation[]; containers: StockLocation[] };
  value: StockLocation | null;
  onChange: (location: StockLocation) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  /** Each option's second line; by default a van's technician and department. */
  hint?: (location: StockLocation) => string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
}) {
  const empty = groups.warehouses.length === 0 && groups.containers.length === 0;
  const listId = useId();

  return (
    <Popover.Root open={open && !disabled} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          disabled={disabled}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? value.name : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </Popover.Trigger>

      {/* Portalled: the popups hold the picker in a body that scrolls, and a
          list drawn inside it was cut off by that body and the footer — one
          van visible out of ninety. */}
      <Popover.Portal>
        <Popover.Content
          id={listId}
          align="start"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-(--radix-popover-trigger-width) overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
            <Command loop>
              <CommandInput autoFocus placeholder={searchPlaceholder} className="h-9" />
              <CommandList className="max-h-[min(18rem,var(--radix-popover-content-available-height))]">
                {loading ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">Loading locations…</div>
                ) : empty ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>
                ) : (
                  <>
                    <CommandEmpty>No location matches.</CommandEmpty>
                    <Group heading="Warehouses" locations={groups.warehouses} value={value} onPick={onChange} hint={hint} />
                    <Group heading="Containers" locations={groups.containers} value={value} onPick={onChange} hint={hint} />
                  </>
                )}
              </CommandList>
            </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Group({
  heading,
  locations,
  value,
  onPick,
  hint: hintOf,
}: {
  heading: string;
  locations: StockLocation[];
  value: StockLocation | null;
  onPick: (location: StockLocation) => void;
  hint: (location: StockLocation) => string;
}) {
  if (locations.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {locations.map((l) => {
        const hint = hintOf(l);
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
