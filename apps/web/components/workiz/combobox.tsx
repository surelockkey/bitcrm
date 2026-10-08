"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Popover } from "radix-ui";

import { cn } from "@/lib/utils";

/*
 * The listbox machinery behind WzSelect, WzMultiSelect and WzTimeSelect:
 * react-select's behaviour (Workiz ships react-select v3) rebuilt on a Radix
 * Popover, so no new dependency.
 *
 * Why not cmdk, which the app already has: its <Command.Input> hard-codes
 * `aria-expanded="true"`, overwrites the input's `id` and labels it with its
 * own hidden <label>, so a real visible <label for> and a truthful expanded
 * state are impossible through it; it also swallows Enter on a closed menu
 * and reorders DOM nodes while filtering. The behaviour below is small enough
 * to own outright.
 */

export interface WzOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Decides whether an option survives the typed text. */
export type WzFilter = (option: WzOption, input: string) => boolean;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * react-select's default filter (ignore case and accents, trim, match
 * anywhere), on the label only: react-select also matches the value, which
 * here is an id nobody should be able to type their way into.
 */
export const containsFilter: WzFilter = (option, input) => {
  const q = fold(input);
  return !q || fold(option.label).includes(q);
};

export interface ComboRow {
  key: string;
  label: string;
  disabled?: boolean;
  option?: WzOption;
  /** The "+ Add new" row. */
  create?: boolean;
}

const CREATE_KEY = "create";
const optionKey = (value: string) => `v:${value}`;
/** react-select's pageSize. */
const PAGE = 5;

export interface UseComboboxArgs {
  /** The input's id; listbox and option ids derive from it. */
  id: string;
  options: WzOption[];
  isSelected: (option: WzOption) => boolean;
  onPick: (option: WzOption) => void;
  /** Keep picked options out of the list (multi-select, the time list). */
  hideSelected?: boolean;
  /** Null turns local filtering off (the caller filters, e.g. on the server). */
  filterOption?: WzFilter | null;
  searchable?: boolean;
  disabled?: boolean;
  /** An action row first in the list, e.g. "+ Add new"; gets the typed text. */
  create?: { label: string; onCreate: (input: string) => void };
  onInputChange?: (input: string) => void;
  onBlur?: () => void;
  /** Backspace / Delete in an empty input: clear, or drop the last chip. */
  onBackspaceEmpty?: () => void;
  /**
   * Where the list starts scrolled when it opens. Default: the focused
   * option in view. The time list instead starts at the slot after the
   * chosen time, as Workiz's does.
   */
  onOpenScroll?: (list: HTMLElement) => void;
}

/**
 * react-select never flips its menu above the control: it opens below and
 * scrolls the page until the menu (and its 8px margin) is on screen — which
 * is why Workiz's page jumps up a little when a low select opens
 * (new_02_job_type_open is the New Job page scrolled by 60px). Same here,
 * on the nearest scrolling ancestor.
 */
function revealBelow(anchor: HTMLElement, menu: HTMLElement) {
  const need = anchor.getBoundingClientRect().bottom + 8 + menu.offsetHeight + 8;
  let scroller: HTMLElement | null = anchor.parentElement;
  while (scroller) {
    const oy = getComputedStyle(scroller).overflowY;
    if ((oy === "auto" || oy === "scroll") && scroller.scrollHeight > scroller.clientHeight) break;
    scroller = scroller.parentElement;
  }
  const bottom = Math.min(scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight, window.innerHeight);
  const over = need - bottom;
  if (over <= 0) return;
  if (scroller) scroller.scrollTop += over;
  else window.scrollBy(0, over);
}

function scrollWithin(list: HTMLElement, el: HTMLElement) {
  const top = el.offsetTop;
  const bottom = top + el.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
}

export function useCombobox({
  id,
  options,
  isSelected,
  onPick,
  hideSelected = false,
  filterOption = containsFilter,
  searchable = true,
  disabled = false,
  create,
  onInputChange,
  onBlur,
  onBackspaceEmpty,
  onOpenScroll,
}: UseComboboxArgs) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** "open" right after opening, "focus" after a keyboard move, else null. */
  const scrollPending = useRef<"open" | "focus" | null>(null);

  const rows = useMemo<ComboRow[]>(() => {
    const shown = hideSelected ? options.filter((o) => !isSelected(o)) : options;
    const filtered = filterOption && input ? shown.filter((o) => filterOption(o, input)) : shown;
    const list: ComboRow[] = filtered.map((o) => ({
      key: optionKey(o.value),
      label: o.label,
      disabled: o.disabled,
      option: o,
    }));
    return create ? [{ key: CREATE_KEY, label: create.label, create: true }, ...list] : list;
  }, [options, hideSelected, isSelected, filterOption, input, create]);

  const enabled = useMemo(() => rows.filter((r) => !r.disabled), [rows]);
  const focusedIndex = useMemo(() => {
    const i = rows.findIndex((r) => r.key === focusKey && !r.disabled);
    return i >= 0 ? i : rows.findIndex((r) => !r.disabled);
  }, [rows, focusKey]);
  const focused = focusedIndex >= 0 ? rows[focusedIndex] : undefined;

  const listboxId = `${id}-listbox`;
  const rowId = (index: number) => `${id}-option-${index}`;

  const setInputText = useCallback(
    (v: string) => {
      setInput(v);
      onInputChange?.(v);
    },
    [onInputChange],
  );

  const openMenu = (which: "first" | "last") => {
    if (disabled) return;
    const chosen = rows.find((r) => r.option && !r.disabled && isSelected(r.option));
    setFocusKey(which === "last" ? (enabled.at(-1)?.key ?? null) : (chosen?.key ?? null));
    setOpen(true);
    scrollPending.current = "open";
  };

  const close = () => {
    setOpen(false);
    setFocusKey(null);
    if (input) setInputText("");
  };

  const pick = (row: ComboRow | undefined) => {
    if (!row || row.disabled) return;
    if (row.create) create?.onCreate(input);
    else if (row.option) onPick(row.option);
    close();
  };

  const move = (delta: number, mode: "wrap" | "clamp") => {
    if (!enabled.length) return;
    const current = enabled.findIndex((r) => r.key === focused?.key);
    let next = current + delta;
    next =
      mode === "wrap"
        ? ((next % enabled.length) + enabled.length) % enabled.length
        : Math.max(0, Math.min(enabled.length - 1, next));
    setFocusKey(enabled[next].key);
    scrollPending.current = "focus";
  };

  const focusEdge = (edge: "first" | "last") => {
    const row = edge === "first" ? enabled[0] : enabled.at(-1);
    if (!row) return;
    setFocusKey(row.key);
    scrollPending.current = "focus";
  };

  /** Bring the focused row into the list's view. */
  const scrollToFocused = (list: HTMLElement) => {
    const el = focusedIndex >= 0 ? document.getElementById(rowId(focusedIndex)) : null;
    if (el) scrollWithin(list, el);
  };

  /** First paint of an open list: make room below, then start where asked. */
  const onListShown = useRef<(list: HTMLElement) => void>(() => {});
  useLayoutEffect(() => {
    onListShown.current = (list) => {
      const anchor = inputRef.current?.closest<HTMLElement>("[data-wz-combobox-root]");
      if (anchor) revealBelow(anchor, list);
      if (onOpenScroll) onOpenScroll(list);
      else scrollToFocused(list);
    };
  });

  // The list mounts a render after `open` flips (Radix Presence), so the
  // opening scroll runs when its node arrives rather than in an effect here.
  const setListEl = useCallback((el: HTMLDivElement | null) => {
    listRef.current = el;
    if (el && scrollPending.current === "open") {
      scrollPending.current = null;
      onListShown.current(el);
    }
  }, []);

  // Keep what the keyboard lands on in view.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list || scrollPending.current !== "focus") return;
    scrollPending.current = null;
    scrollToFocused(list);
  });

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    const composing = e.nativeEvent.isComposing || e.keyCode === 229;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (open) move(1, "wrap");
        else openMenu("first");
        return;
      case "ArrowUp":
        e.preventDefault();
        if (open) move(-1, "wrap");
        else openMenu("last");
        return;
      case "PageDown":
        if (!open) return;
        e.preventDefault();
        move(PAGE, "clamp");
        return;
      case "PageUp":
        if (!open) return;
        e.preventDefault();
        move(-PAGE, "clamp");
        return;
      case "Home":
        if (!open) return;
        e.preventDefault();
        focusEdge("first");
        return;
      case "End":
        if (!open) return;
        e.preventDefault();
        focusEdge("last");
        return;
      case "Enter":
        // Closed, Enter is left alone (react-select does the same).
        if (composing || !open) return;
        e.preventDefault();
        pick(focused);
        return;
      case "Tab":
        if (composing || e.shiftKey || !open || !focused) return;
        pick(focused);
        return;
      case "Escape":
        if (!open) return;
        e.preventDefault();
        close();
        return;
      case " ":
        if (input) return;
        e.preventDefault();
        if (open) pick(focused);
        else openMenu("first");
        return;
      case "Backspace":
      case "Delete":
        if (input || !onBackspaceEmpty) return;
        e.preventDefault();
        onBackspaceEmpty();
        return;
    }
  };

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!searchable || disabled) return;
    setInputText(e.target.value);
    setFocusKey(null);
    setOpen(true);
    scrollPending.current = "focus";
  };

  const onInputBlur = () => {
    close();
    onBlur?.();
  };

  /**
   * Mouse-down anywhere on the control: focus the input and open, or toggle
   * when already focused — react-select's onControlMouseDown. A press on the
   * input itself is left to place the caret.
   */
  const onControlMouseDown = (e: MouseEvent<HTMLElement>, root: RefObject<HTMLElement | null>) => {
    if (disabled || e.button !== 0) return;
    // Events from the portaled menu bubble here through React; not ours.
    if (!root.current?.contains(e.target as Node)) return;
    const el = inputRef.current;
    if (!el) return;
    if (e.target === el) {
      if (!open) openMenu("first");
      return;
    }
    e.preventDefault();
    if (document.activeElement !== el) {
      el.focus();
      openMenu("first");
      return;
    }
    if (open) close();
    else openMenu("first");
  };

  const inputProps = {
    id,
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-haspopup": "listbox" as const,
    "aria-expanded": open,
    "aria-controls": open ? listboxId : undefined,
    "aria-activedescendant": open && focusedIndex >= 0 ? rowId(focusedIndex) : undefined,
    autoComplete: "off",
    autoCorrect: "off",
    spellCheck: false,
    readOnly: !searchable,
    disabled,
    value: input,
    onChange,
    onKeyDown,
    onBlur: onInputBlur,
  };

  return {
    open,
    input,
    rows,
    focusedIndex,
    listboxId,
    rowId,
    inputRef,
    setListEl,
    inputProps,
    pick,
    close,
    openMenu,
    setFocusKey,
    onControlMouseDown,
  };
}

export type Combobox = ReturnType<typeof useCombobox>;

/**
 * The open menu: a Radix Popover pinned under the control, as wide as it,
 * holding a listbox. `look` switches between react-select's stock menu
 * (New Job selects) and the newer time list.
 */
export function ComboboxMenu({
  combo,
  anchor,
  labelId,
  isSelected,
  look = "select",
  multiple = false,
  noOptionsMessage = "No options",
  loading = false,
  renderRow,
}: {
  combo: Combobox;
  anchor: ReactNode;
  /** The visible <label>'s id: it names the listbox too. */
  labelId: string;
  isSelected: (option: WzOption) => boolean;
  look?: "select" | "time";
  multiple?: boolean;
  noOptionsMessage?: string;
  loading?: boolean;
  renderRow?: (row: ComboRow, state: { focused: boolean; selected: boolean }) => ReactNode;
}) {
  const { open, rows, focusedIndex, listboxId, rowId, setListEl, inputRef } = combo;
  return (
    <Popover.Root open={open} onOpenChange={(next) => (!next ? combo.close() : undefined)}>
      <Popover.Anchor asChild>{anchor}</Popover.Anchor>
      <Popover.Portal container={typeof document === "undefined" ? undefined : document.body}>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={8}
          // Below, always — react-select scrolls the page instead of flipping.
          avoidCollisions={false}
          // Focus stays in the input the whole time, as in react-select.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            const target = e.target as Node | null;
            const root = inputRef.current?.closest("[data-wz-combobox-root]");
            if (target && root?.contains(target)) e.preventDefault();
          }}
          className={cn(
            "z-[101] w-[var(--radix-popover-trigger-width)] bg-white outline-none",
            // react-select's menu: 4px corners and its two-part shadow.
            "rounded-[4px] shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_4px_11px_rgba(0,0,0,0.1)]",
          )}
        >
          <div
            ref={setListEl}
            id={listboxId}
            role="listbox"
            aria-labelledby={labelId}
            aria-multiselectable={multiple || undefined}
            // A press on the list (its scrollbar too) must not steal focus from the input.
            onMouseDown={(e) => e.preventDefault()}
            className={cn(
              "relative max-h-[300px] overflow-y-auto py-1",
              look === "time"
                ? "rounded-[8px] shadow-[0_8px_16px_rgba(59,75,82,0.15),0_0_4px_rgba(59,75,82,0.05)]"
                : undefined,
            )}
          >
            {rows.length === 0 ? (
              <div
                role="presentation"
                className={cn(
                  "px-3 py-2 text-center text-wz-caption",
                  look === "time" ? "text-[13px] leading-4" : "text-[14px] leading-4",
                )}
              >
                {loading ? "Loading..." : noOptionsMessage}
              </div>
            ) : (
              rows.map((row, index) => {
                const isFocused = index === focusedIndex;
                const selected = !!row.option && isSelected(row.option);
                return (
                  <div
                    key={row.key}
                    id={rowId(index)}
                    role="option"
                    aria-selected={selected}
                    aria-disabled={row.disabled || undefined}
                    data-focused={isFocused || undefined}
                    data-selected={selected || undefined}
                    onMouseMove={() => (!row.disabled && !isFocused ? combo.setFocusKey(row.key) : undefined)}
                    onClick={() => combo.pick(row)}
                    className={cn(
                      "block w-full cursor-default px-3 py-2 select-none",
                      look === "time"
                        ? cn("text-[13px] leading-4 text-foreground", isFocused && "bg-wz-option-soft")
                        : cn(
                            "text-[14px] leading-4 text-wz-strong",
                            // react-select: chosen #2684ff/white, focused #deebff,
                            // pressed #b2d4ff, disabled #ccc.
                            selected
                              ? "bg-wz-option-selected text-white"
                              : isFocused
                                ? "bg-wz-option-focus active:bg-[#b2d4ff]"
                                : undefined,
                            row.disabled && "text-input",
                          ),
                    )}
                  >
                    {renderRow ? renderRow(row, { focused: isFocused, selected }) : row.label}
                  </div>
                );
              })
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
