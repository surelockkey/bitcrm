"use client";

import { useId, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ChevronUp, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Workiz's filter row on its newer list pages (calls: callspage_wz_05_*):
 * "+ Add filter" opens a menu of filter kinds; each kind picked becomes a
 * grey chip "Direction is (any)" whose panel lists the options and "Apply".
 */

/** The 274px menu / 300px panel: white, radius 8, `0 0 10px rgba(0,0,0,.1)`. */
const PANEL = "z-50 rounded-[8px] bg-background shadow-[0_0_10px_rgba(0,0,0,0.1)] outline-none";

/** The 40px search box at the top of the menu and of every panel (Input-module). */
function PanelSearch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-[15px] size-[18px] -translate-y-1/2 text-foreground" strokeWidth={1.75} />
      <input
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[4px] border border-wz-outline bg-background pr-4 pl-11 text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline focus:border-wz-link"
      />
    </div>
  );
}

/**
 * "+ Add filter" (callspage_wz_05_add_filter): a tertiary pill — 32px,
 * radius 20, 6.5px 12px, 13px/19px 600 ink, `#f3f6f7` while hovered or open —
 * over a 274px menu: "Search filters", then the kinds as 32px rows (14px/21px
 * ink, 12px in). Picking one closes it. Not drawn with nothing left to add.
 */
export function WzAddFilter({
  kinds,
  onAdd,
}: {
  kinds: { id: string; label: string }[];
  onAdd: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  if (!kinds.length) return null;
  const q = query.trim().toLowerCase();
  const shown = kinds.filter((k) => !q || k.label.toLowerCase().includes(q));
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "h-8 shrink-0 rounded-[20px] px-3 py-[6.5px] text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground hover:bg-wz-secondary-hover",
            open && "bg-wz-secondary-hover",
          )}
        >
          <span className="px-1">+ Add filter</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          role="menu"
          aria-label="Add filter"
          align="start"
          side="bottom"
          sideOffset={8}
          className={cn(PANEL, "w-[274px] px-3 pt-3 pb-3")}
        >
          <PanelSearch label="Search filters" value={query} onChange={setQuery} />
          <div className="pt-3">
            {shown.map((k) => (
              <button
                key={k.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setQuery("");
                  onAdd(k.id);
                }}
                className="flex h-8 w-full items-center rounded-[4px] px-3 text-left text-sm leading-[21px] text-foreground hover:bg-[#f1f2f3]"
              >
                {k.label}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One applied filter (callspage_wz_05_filter_direction): a 32px chip,
 * `#dfe2e3`, radius 4, 6px 8px — "Direction" (600) "is" "(any)" (600) in
 * 13px/19px `#6aa8ee`, a chevron that points up while the panel is open,
 * and a × that takes the filter off. The panel hangs 8px under it.
 */
export function WzFilterField({
  name,
  value,
  open,
  onOpenChange,
  onRemove,
  children,
}: {
  name: string;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: () => void;
  /** The panel: usually a `WzFilterOptions`. */
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>
        <div className="flex h-8 shrink-0 items-center gap-1 rounded-[4px] bg-border px-2 text-[13px] leading-[19px] text-wz-link">
          <Popover.Trigger asChild>
            <button type="button" aria-label={`${name} is ${value}`} className="flex items-center gap-1 whitespace-nowrap">
              <span className="font-semibold">{name}</span>
              <span>is</span>
              <span className="max-w-[16rem] truncate font-semibold">{value}</span>
              <ChevronUp className={cn("size-4 transition-transform", !open && "rotate-180")} strokeWidth={1.5} />
            </button>
          </Popover.Trigger>
          <button type="button" aria-label={`Remove ${name} filter`} onClick={onRemove} className="grid size-4 place-items-center">
            <X className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content align="start" side="bottom" sideOffset={8} className={cn(PANEL, "w-[300px] overflow-hidden")}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A chip's panel (callspage_wz_05_filter_*): "Search …" (8px round it),
 * then 36px option rows (10px 24px, 14px `#566d76`, the browser's 13px box
 * 8px before the words, `#f1f2f3` under the cursor), "Select All" first where
 * several can be ticked, and a 45px "Apply" (14px/600 `#3589e9`) under a 1px
 * `#dfe2e3` rule. Nothing applies until Apply. A filter the server takes one
 * value for draws radio buttons instead of boxes.
 */
export function WzFilterOptions({
  searchLabel,
  options,
  selected,
  multi = false,
  onApply,
}: {
  searchLabel: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  selected: string[];
  multi?: boolean;
  onApply: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>(selected);
  const group = useId();
  const q = query.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q));
  const allTicked = options.length > 0 && options.every((o) => draft.includes(o.value));

  const toggle = (value: string) =>
    setDraft((d) => (multi ? (d.includes(value) ? d.filter((v) => v !== value) : [...d, value]) : [value]));

  const row = "flex h-9 cursor-pointer items-center gap-2 rounded-[4px] px-6 text-sm leading-4 text-wz-slate hover:bg-[#f1f2f3]";
  return (
    <div>
      <div className="p-2">
        <PanelSearch label={searchLabel} value={query} onChange={setQuery} />
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {multi && !q ? (
          <label className={row}>
            <input
              type="checkbox"
              className="size-[13px] shrink-0"
              checked={allTicked}
              onChange={() => setDraft(allTicked ? [] : options.map((o) => o.value))}
            />
            <span>Select All</span>
          </label>
        ) : null}
        {shown.map((o) => (
          <label key={o.value} className={row}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={multi ? undefined : group}
              className="size-[13px] shrink-0"
              checked={draft.includes(o.value)}
              onChange={() => toggle(o.value)}
            />
            {o.icon}
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onApply(options.map((o) => o.value).filter((v) => draft.includes(v)))}
        className="block h-[45px] w-full border-t border-border text-center text-sm leading-4 font-semibold text-brand hover:bg-wz-tile"
      >
        Apply
      </button>
    </div>
  );
}
