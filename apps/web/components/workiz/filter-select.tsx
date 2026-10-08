"use client";

import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { WzFilterChip } from "./filter-chip";

/** One choice: plain words, or a chip in its own colour (a tag's) — `colorClassName` / `style`. */
export interface WzFilterOption {
  value: string;
  label: string;
  colorClassName?: string;
  style?: CSSProperties;
}

/** One column of the menu: "TAGS", "HAS SERVICE PLAN". `chipPrefix` names the pick ("tag: PLATINUM"). */
export interface WzFilterGroup {
  id: string;
  title: string;
  chipPrefix?: string;
  options: WzFilterOption[];
}

export interface WzFilterPick {
  group: string;
  value: string;
}

/**
 * What the open menu lists: every group's options less the ones picked,
 * narrowed by the typed text (anywhere in the label, any case); a group with
 * nothing left closes up, as react-select's do.
 */
export function filterSelectGroups(groups: readonly WzFilterGroup[], picked: readonly WzFilterPick[], query: string): WzFilterGroup[] {
  const q = query.trim().toLowerCase();
  return groups
    .map((g) => ({
      ...g,
      options: g.options.filter(
        (o) => !picked.some((p) => p.group === g.id && p.value === o.value) && (!q || o.label.toLowerCase().includes(q)),
      ),
    }))
    .filter((g) => g.options.length > 0);
}

/**
 * Workiz's "Filter results" over a list (pg_contacts_wz_03_filter_open,
 * pg_contacts_wz_12_filter_two_tags; the jobs list has its own richer one): a
 * react-select you type straight into — 38px, 1px #ccc, 4px corners; the
 * focused / open box drops its edge for a 1px #ffd400 ring. Picks sit inside
 * as `WzFilterChip`s ("tag: PLATINUM ×"), a clear-all × and a chevron behind
 * a rule at the right. Open, the groups lie side by side 8px under the box —
 * 10.5px #999 capitals over 32px rows, #deebff under the cursor, coloured
 * values drawn as their chips. A pick closes the menu; Backspace in an empty
 * box takes the last chip off.
 */
export function WzFilterSelect({
  groups,
  value,
  onChange,
  placeholder = "Filter results",
  className,
}: {
  groups: readonly WzFilterGroup[];
  value: readonly WzFilterPick[];
  onChange: (next: WzFilterPick[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const controlRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();

  const shown = useMemo(() => filterSelectGroups(groups, value, query), [groups, value, query]);
  const flat = useMemo(() => shown.flatMap((g) => g.options.map((o) => ({ group: g.id, option: o }))), [shown]);

  const chips = value.flatMap((p) => {
    const g = groups.find((x) => x.id === p.group);
    const o = g?.options.find((x) => x.value === p.value);
    if (!g || !o) return [];
    return [{ pick: p, label: g.chipPrefix ? `${g.chipPrefix}: ${o.label}` : o.label, option: o }];
  });

  const pick = (group: string, option: WzFilterOption) => {
    onChange([...value, { group, value: option.value }]);
    setQuery("");
    setActive(0);
    setOpen(false);
    inputRef.current?.focus();
  };
  const remove = (p: WzFilterPick) => onChange(value.filter((v) => !(v.group === p.group && v.value === p.value)));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[active];
      if (open && hit) pick(hit.group, hit.option);
    } else if (e.key === "Backspace" && !query && value.length) {
      onChange(value.slice(0, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          ref={controlRef}
          data-slot="wz-filter-select"
          onMouseDown={(e) => {
            // The whole box is the select: a press anywhere opens it and keeps the caret in the input.
            if (e.target !== inputRef.current) {
              e.preventDefault();
              inputRef.current?.focus();
            }
            setOpen(true);
          }}
          className={cn(
            "flex min-h-[38px] min-w-0 cursor-default items-center rounded-[4px] border border-input bg-background",
            "focus-within:border-transparent focus-within:shadow-[0_0_0_1px_var(--wz-focus)]",
            open && "border-transparent shadow-[0_0_0_1px_var(--wz-focus)]",
            className,
          )}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-[3px] pr-1 pl-2.5">
            {chips.map((c) => (
              <WzFilterChip
                key={`${c.pick.group}:${c.pick.value}`}
                label={c.label}
                colorClassName={c.option.colorClassName ?? null}
                onRemove={() => remove(c.pick)}
              />
            ))}
            <div className="relative min-w-[2px] flex-1">
              {!chips.length && !query ? (
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-base leading-4 text-wz-placeholder">
                  {placeholder}
                </span>
              ) : null}
              <input
                ref={inputRef}
                aria-label={placeholder}
                role="combobox"
                aria-expanded={open}
                aria-controls={menuId}
                aria-autocomplete="list"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                  setOpen(true);
                }}
                onKeyDown={onKey}
                className="h-[30px] w-full min-w-[2px] bg-transparent text-sm text-wz-value outline-none"
              />
            </div>
          </div>
          {chips.length ? (
            <button
              type="button"
              aria-label="Clear filters"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onChange([])}
              className="grid size-9 place-items-center text-wz-text hover:text-wz-value"
            >
              <X className="size-3.5" strokeWidth={3} />
            </button>
          ) : null}
          <span aria-hidden className="h-5 w-px self-center bg-input" />
          <span aria-hidden className="grid h-9 w-9 place-items-center text-input">
            <ChevronDown className={cn("size-5", open && "text-wz-text")} />
          </span>
        </div>
      </Popover.Anchor>

      <Popover.Portal>
        <Popover.Content
          id={menuId}
          align="start"
          side="bottom"
          sideOffset={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (controlRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          style={{ width: "var(--radix-popper-anchor-width)" }}
          className="z-50 rounded-[4px] bg-popover text-sm text-wz-strong shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]"
        >
          <div className="max-h-[300px] overflow-auto py-1">
            {shown.length ? (
              <div className="grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
                {shown.map((g) => (
                  <section key={g.id} role="listbox" aria-label={g.title} className="min-w-0 pt-2">
                    <h3 className="mb-0.5 h-4 px-3 text-[10.5px] leading-4 font-medium tracking-[0.4px] text-wz-caption uppercase">
                      {g.title}
                    </h3>
                    {g.options.map((o) => {
                      const i = flat.findIndex((f) => f.group === g.id && f.option.value === o.value);
                      const chip = Boolean(o.colorClassName || o.style);
                      return (
                        <button
                          key={o.value}
                          type="button"
                          role="option"
                          aria-selected={i === active}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => pick(g.id, o)}
                          className={cn("block h-8 w-full truncate px-3 text-left leading-8", i === active && "bg-wz-option-focus")}
                        >
                          {chip ? (
                            <span
                              className={cn("rounded-[3px] px-1 py-px text-sm leading-4 font-medium text-white", o.colorClassName)}
                              style={o.style}
                            >
                              {o.label}
                            </span>
                          ) : (
                            o.label
                          )}
                        </button>
                      );
                    })}
                  </section>
                ))}
              </div>
            ) : (
              <p className="px-3 py-2 text-center text-wz-caption">No options</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
