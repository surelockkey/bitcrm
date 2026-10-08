"use client";

import { useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";
import { useCombobox, type ComboRow, type Combobox, type WzOption } from "./combobox";
import { RsChevronIcon, RsCrossIcon } from "./icons";
import { mergeRefs } from "./refs";

/** One value a group offers. `className` paints it as a chip in the list (a tag's colour). */
export interface WzFilterGroupOption {
  value: string;
  label: string;
  className?: string;
}

/**
 * A group of the filter: its column heading (`label`, "Status"), the word its
 * chips start with (`chip`, Workiz's filter key: "status", "user", "tag"…)
 * and its values, in the order they are listed.
 */
export interface WzFilterGroup<K extends string = string> {
  key: K;
  label: string;
  chip: string;
  options: WzFilterGroupOption[];
}

/** The picks, by group key; a group with nothing picked is absent. */
export type WzFilterValue<K extends string = string> = Partial<Record<K, string[]>>;

export interface WzFilterChip {
  group: string;
  value: string;
  label: string;
}

/**
 * The chips the box shows: "status: Done", "user: Sam Tech". Groups in
 * `order` (Workiz lists them in its filters object's order, not the menu's),
 * then any group `order` leaves out; inside a group, in the order picked.
 */
export function wzFilterChips(groups: readonly WzFilterGroup[], value: WzFilterValue, order?: readonly string[]): WzFilterChip[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const keys = [...(order ?? []), ...groups.map((g) => g.key).filter((k) => !order?.includes(k))];
  return keys.flatMap((key) => {
    const group = byKey.get(key);
    if (!group) return [];
    return (value[key] ?? []).map((v) => ({
      group: key,
      value: v,
      label: `${group.chip}: ${group.options.find((o) => o.value === v)?.label ?? v}`,
    }));
  });
}

/** One menu row's key: group and value, which no label or id contains. */
const SEP = "\u001f";
const rowKey = (group: string, value: string) => `${group}${SEP}${value}`;
const splitKey = (key: string): [string, string] => {
  const i = key.indexOf(SEP);
  return [key.slice(0, i), key.slice(i + 1)];
};

function without(value: WzFilterValue, group: string, v: string): WzFilterValue {
  const left = (value[group] ?? []).filter((x) => x !== v);
  const next = { ...value };
  if (left.length) next[group] = left;
  else delete next[group];
  return next;
}

/*
 * Geometry (rep_jobs_wz_01_default / _05_filter_open / _17e_chip_remove_hover):
 *   control  38px, white, 1px #ccc, 4px corners; hover edge #b3b3b3. Open or
 *            focused: the edge goes (36px) and a 1px #ffd400 ring is drawn.
 *   words    "Select..." 16px #808080 at 11px; chips 24px — 1px #ccc, 2px
 *            corners, 11.9px #333 (3px 3px 3px 6px), a 23px × behind a #ccc
 *            rule; 2px between.
 *   indicators  [× clear] | 1px #ccc separator | chevron, 36px each, #ccc
 *            (#666 while focused).
 *   menu     8px below, as wide as the box, 300px at most, 4px corners,
 *            react-select's two-part shadow; one column per group, 150px or
 *            a share of the width when fewer fit; headings 10.5px/500 #999
 *            capitals 12px in; options 32px (8px 12px), 14px #404040,
 *            focused #deebff; a tag drawn as its chip (14px/500 white, 3px
 *            corners, 1px 4px).
 */
const CONTROL = cn(
  "flex min-h-[38px] w-full items-center rounded-[4px] border border-input bg-white text-[14px] leading-4 text-wz-strong transition-colors duration-100",
  "hover:border-wz-field-hover",
  "group-data-[focused=true]/wzgf:min-h-9 group-data-[focused=true]/wzgf:border-0 group-data-[focused=true]/wzgf:shadow-[0_0_0_1px_var(--wz-focus)]",
);

const INDICATOR = cn(
  "flex items-center p-2 text-input transition-colors duration-150 hover:text-wz-caption",
  "group-data-[focused=true]/wzgf:text-wz-text group-data-[focused=true]/wzgf:hover:text-wz-value",
);

/**
 * Workiz's "Filter results" box on its reports (the Jobs report's
 * MultiFilter): a react-select that takes values from several groups at once.
 * Open, the groups stand side by side — Status, Team, Created by… — and the
 * list scrolls both ways; typing in the box narrows every group and drops
 * the ones left empty. A pick closes the list and becomes a chip
 * ("status: Done"); its × drops it, Backspace drops the last, the clear ×
 * drops them all. Picked values leave the list. The keyboard walks the
 * options group after group, as react-select does.
 */
export function WzGroupedFilter<K extends string = string>({
  groups,
  value,
  onChange,
  chipOrder,
  placeholder = "Select...",
  "aria-label": ariaLabel = "Filter results",
  className,
}: {
  groups: readonly WzFilterGroup<K>[];
  value: WzFilterValue<K>;
  onChange: (next: WzFilterValue<K>) => void;
  /** Group keys in the order their chips are listed (default: the menu's). */
  chipOrder?: readonly K[];
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
}) {
  const id = `wz-gf-${useId()}`;
  const labelId = `${id}-label`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  const current = value as WzFilterValue;
  const chips = wzFilterChips(groups, current, chipOrder);

  const flat = useMemo<WzOption[]>(
    () =>
      groups.flatMap((g) =>
        g.options.map((o) => ({
          value: rowKey(g.key, o.value),
          label: o.label,
        })),
      ),
    [groups],
  );
  const optionOf = useMemo(() => {
    const m = new Map<string, WzFilterGroupOption>();
    for (const g of groups) for (const o of g.options) m.set(rowKey(g.key, o.value), o);
    return m;
  }, [groups]);

  const isSelected = useCallback(
    (o: WzOption) => {
      const [g, v] = splitKey(o.value);
      return !!current[g]?.includes(v);
    },
    [current],
  );

  const set = (next: WzFilterValue) => onChange(next as WzFilterValue<K>);

  const combo = useCombobox({
    id,
    options: flat,
    isSelected,
    hideSelected: true,
    onPick: (o) => {
      const [g, v] = splitKey(o.value);
      set({ ...current, [g]: [...(current[g] ?? []), v] });
    },
    onBlur: () => setFocused(false),
    onBackspaceEmpty: chips.length
      ? () => {
          const last = chips[chips.length - 1];
          set(without(current, last.group, last.value));
        }
      : undefined,
  });

  const showPlaceholder = chips.length === 0 && !combo.input;

  return (
    <div
      ref={rootRef}
      data-slot="wz-grouped-filter"
      data-wz-combobox-root=""
      data-focused={focused || combo.open ? "true" : "false"}
      className={cn("group/wzgf relative min-w-0", className)}
      onMouseDown={(e) => combo.onControlMouseDown(e, rootRef)}
    >
      <span id={labelId} className="sr-only">
        {ariaLabel}
      </span>
      <GroupedMenu
        combo={combo}
        groups={groups}
        optionOf={optionOf}
        labelId={labelId}
        anchor={
          <div data-slot="wz-grouped-filter-control" className={CONTROL}>
            {/* react-select's value box: 2px 8px, wrapping. */}
            <div className="relative flex min-h-7 min-w-0 flex-1 flex-wrap items-center px-2 py-0.5">
              {showPlaceholder ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute top-[5px] left-[10px] max-w-[calc(100%-20px)] truncate text-[16px] leading-4 text-wz-placeholder"
                >
                  {placeholder}
                </span>
              ) : null}
              {chips.map((c) => (
                <div
                  key={`${c.group}|${c.value}`}
                  data-slot="wz-filter-chip"
                  className="m-0.5 flex h-6 min-w-0 rounded-chip border border-input bg-white"
                >
                  <span className="truncate rounded-chip py-[3px] pr-[3px] pl-1.5 text-[11.9px] leading-4 text-wz-value">
                    {c.label}
                  </span>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Remove ${c.label}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={() => set(without(current, c.group, c.value))}
                    className="flex w-[23px] shrink-0 items-center justify-center rounded-chip border-l border-input bg-white px-1 text-wz-value hover:bg-wz-secondary-hover"
                  >
                    <RsCrossIcon size={14} />
                  </button>
                </div>
              ))}
              <input
                {...combo.inputProps}
                ref={mergeRefs(combo.inputRef)}
                aria-label={ariaLabel}
                onFocus={() => setFocused(true)}
                className="m-0.5 h-5 w-[2px] min-w-[2px] flex-1 bg-transparent py-0.5 text-[14px] leading-4 text-wz-value outline-none"
              />
            </div>
            <div className="flex shrink-0 items-center self-stretch">
              {chips.length ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label="Clear filters"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => {
                    set({});
                    combo.inputRef.current?.focus();
                  }}
                  className={INDICATOR}
                >
                  <RsCrossIcon />
                </button>
              ) : null}
              <span aria-hidden className="my-2 w-px self-stretch bg-input" />
              <span aria-hidden className={INDICATOR}>
                <RsChevronIcon />
              </span>
            </div>
          </div>
        }
      />
    </div>
  );
}

/**
 * The open list: a Radix Popover under the control, as wide as it, holding
 * one column per group that still has options.
 */
function GroupedMenu({
  combo,
  groups,
  optionOf,
  labelId,

  anchor,
}: {
  combo: Combobox;
  groups: readonly WzFilterGroup<string>[];
  optionOf: Map<string, WzFilterGroupOption>;
  labelId: string;

  anchor: ReactNode;
}) {
  const { open, close, rows, rowId, focusedIndex, setFocusKey, pick, setListEl, listboxId } = combo;
  // The rows the list shows, still in their flat order (their ids and the
  // keyboard use it), gathered under their groups.
  const columns = useMemo(() => {
    const byGroup = new Map<string, { row: ComboRow; index: number }[]>();
    rows.forEach((row, index) => {
      const [g] = splitKey(row.key.replace(/^v:/, ""));
      const list = byGroup.get(g) ?? [];
      list.push({ row, index });
      byGroup.set(g, list);
    });
    return groups.filter((g) => byGroup.has(g.key)).map((g) => ({ group: g, rows: byGroup.get(g.key)! }));
  }, [rows, groups]);

  return (
    <Popover.Root open={open} onOpenChange={(next) => (!next ? close() : undefined)}>
      <Popover.Anchor asChild>{anchor}</Popover.Anchor>
      <Popover.Portal container={typeof document === "undefined" ? undefined : document.body}>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          avoidCollisions={false}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // A press on the box itself is the box's to handle (it toggles the list).
            const root = combo.inputRef.current?.closest("[data-wz-combobox-root]");
            if (root?.contains(e.target as Node)) e.preventDefault();
          }}
          className="z-[101] w-[var(--radix-popover-trigger-width)] rounded-[4px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)] outline-none"
        >
          <div
            ref={setListEl}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            aria-multiselectable
            onMouseDown={(e) => e.preventDefault()}
            className="relative max-h-[300px] overflow-auto py-1"
          >
            {columns.length === 0 ? (
              <div role="presentation" className="px-3 py-2 text-center text-[14px] leading-4 text-wz-caption">
                No options
              </div>
            ) : (
              <div className="flex">
                {columns.map(({ group, rows }) => (
                  <div key={group.key} role="group" aria-label={group.label} className="min-w-[150px] flex-1 basis-0 py-2">
                    <div aria-hidden className="mb-1 truncate px-3 text-[10.5px] leading-4 font-medium text-wz-caption uppercase">
                      {group.label}
                    </div>
                    {rows.map(({ row, index }) => (
                      <Option
                        key={row.key}
                        id={rowId(index)}
                        focused={index === focusedIndex}
                        onHover={() => (index !== focusedIndex ? setFocusKey(row.key) : undefined)}
                        onPick={() => pick(row)}
                        label={row.label}
                        chipClassName={optionOf.get(row.key.replace(/^v:/, ""))?.className}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Option({
  id,
  focused,
  onHover,
  onPick,
  label,
  chipClassName,
}: {
  id: string;
  focused: boolean;
  onHover: () => void;
  onPick: () => void;
  label: string;
  chipClassName?: string;
}): ReactNode {
  return (
    <div
      id={id}
      role="option"
      aria-selected={false}
      data-focused={focused || undefined}
      onMouseMove={onHover}
      onClick={onPick}
      className={cn(
        "block w-full cursor-default truncate px-3 py-2 text-[14px] leading-4 text-wz-strong select-none",
        focused && "bg-wz-option-focus active:bg-[#b2d4ff]",
      )}
    >
      {chipClassName ? (
        <span className={cn("rounded-[3px] px-1 py-px text-[14px] leading-4 font-medium text-white", chipClassName)}>
          {label}
        </span>
      ) : (
        label
      )}
    </div>
  );
}
