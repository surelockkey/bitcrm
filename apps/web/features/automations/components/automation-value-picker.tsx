"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  name: string;
}

/**
 * "One of these" as chips (Workiz's multi-value condition, §1.5.4). It is
 * the control that makes 24 near-identical review rules into one: a
 * condition's `values` has always been an array and `in` / `not_in` have
 * always meant "one of", but a single select could only ever write one of
 * them, so the workspace copied the whole rule per source instead.
 *
 * `labels` are the names the spec carries for ids the catalog has not
 * loaded (or no longer has), so a chip never degrades to a uuid; `onChange`
 * hands both back, in the same order, for the spec to store.
 */
export function AutomationValuePicker({
  label,
  options,
  values,
  labels,
  onChange,
  single,
  placeholder = "Pick one",
  emptyText = "Nothing to pick",
  fallback,
  disabled,
  className,
}: {
  /** Accessible name — the row this picker belongs to ("Condition 1 value"). */
  label: string;
  options: PickerOption[];
  values: string[];
  /** Names the spec stored for `values`, same order. */
  labels?: string[];
  onChange: (values: string[], labels: string[]) => void;
  /** Picking replaces rather than adds (`eq` / `ne` read the first value only). */
  single?: boolean;
  placeholder?: string;
  emptyText?: string;
  /** Names for ids from elsewhere — the rule's own label map. */
  fallback?: Record<string, string | undefined>;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // The picker lives inside a scrolling dialog, so the panel is positioned
  // rather than portalled; closing on an outside pointer keeps it from
  // hanging over whatever the person scrolled to next.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const shut = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  const nameOf = (id: string, index = values.indexOf(id)) =>
    options.find((o) => o.id === id)?.name ?? fallback?.[id] ?? labels?.[index] ?? id;

  const commit = (next: string[]) => onChange(next, next.map((id) => nameOf(id)));

  const drop = (id: string) => commit(values.filter((v) => v !== id));

  const toggle = (id: string) => {
    if (single) {
      commit([id]);
      shut();
      return;
    }
    commit(values.includes(id) ? values.filter((v) => v !== id) : [...values, id]);
  };

  /**
   * Values the catalog cannot name: an archived sub-status, a bare
   * `adgroup:` id the import carried over. They are listed too — the list is
   * the only way into this control from a keyboard, and without them the way
   * to drop one is the chip's `×`, which is a pointer affordance inside the
   * trigger button. That left deleting the whole condition and building it
   * again as the keyboard's only path.
   */
  const unlisted = values.filter((id) => !options.some((o) => o.id === id));

  return (
    <div
      ref={box}
      className={cn("relative", className)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          shut();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex min-h-9 w-full items-center gap-1.5 rounded-md border bg-transparent px-3 py-1.5 text-left text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {values.length === 0 ? (
            <span className="text-muted-foreground">{placeholder}</span>
          ) : (
            values.map((id, i) => (
              <span
                key={id}
                className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/60 px-2 py-0.5 text-xs"
              >
                <span className="truncate">{nameOf(id, i)}</span>
                {/* A chip's × is a span, not a button: a button inside a button
                    is invalid. It is a shortcut for the pointer only — every
                    chip here, named by the catalog or not, is also in the list
                    below and untickable from there. */}
                <span
                  role="presentation"
                  aria-hidden="true"
                  className="opacity-60 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!disabled) drop(id);
                  }}
                >
                  <X className="size-3" />
                </span>
              </span>
            ))
          )}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-56 overflow-hidden rounded-lg border bg-popover shadow-md">
          <Command loop>
            {/* Always here, however short the list: it is what takes focus on
                open, so the whole picker works from the keyboard — type to
                narrow, arrows to move, Enter to tick. */}
            <CommandInput autoFocus placeholder="Search…" className="h-9" />
            <CommandList className="max-h-56">
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  // Keyed by id, searched by name: two statuses may share a
                  // name, and cmdk needs the value it dedupes by to be unique.
                  <CommandItem
                    key={o.id}
                    value={o.id}
                    keywords={[o.name]}
                    onSelect={() => toggle(o.id)}
                    className="gap-2"
                  >
                    <Check className={cn("size-4", values.includes(o.id) ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>

              {unlisted.length ? (
                <CommandGroup heading="Picked, but not in the catalog">
                  {unlisted.map((id) => (
                    // Selecting one can only mean dropping it: it is already
                    // picked, and there is nothing left to pick it from.
                    <CommandItem
                      key={id}
                      value={id}
                      keywords={[nameOf(id)]}
                      onSelect={() => drop(id)}
                      className="gap-2"
                    >
                      <Check className="size-4" />
                      <span className="min-w-0 flex-1 truncate">{nameOf(id)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">no longer in the catalog</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </div>
      ) : null}
    </div>
  );
}
