"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WzLegacyOption {
  value: string;
  label: string;
}

/**
 * The legacy pages' select (`span.select.replacement`, Job Statistics'
 * service area and "All sources": rep_jobstats_wz_02_overview_day,
 * _06_area_open, _10_sources_type_open).
 *
 * Closed: 32px, #f7f7f7, 1px #ccc, radius 2; the value 13px/500 #666 at
 * 7px 10px; a 26px box on the right, ruled off, with a thin chevron.
 * Open: the box turns white (with `searchable`, a "Search" box takes the
 * value's place) and the list hangs 8px under it on a little white caret —
 * white, 1px #ccc, a soft shadow; rows 14px/500 #666, 10px 15px (36px); the
 * chosen row rgba(0,0,0,.75), its words still #666, as Workiz has them.
 *
 * `size="compact"` is Finance Reporting's (Commissions, rep_commission_wz_06_*):
 * a 26px box, the value 13px/500 #666 at 4px 8px (cut 22px from the right, so a
 * long one runs under the 36px chevron box, as Workiz's does); the
 * list 11px under it with a two-part shadow (`0 3px 6px rgba(0,0,0,.18), 0 4px
 * 15px rgba(0,0,0,.15)`) and the chosen row #ededed. `disabled` keeps the look
 * and never opens (Workiz's External Company while an Ad Group is chosen).
 *
 * A combobox + listbox: the arrow keys move, Enter picks, Escape closes.
 */
export function WzLegacySelect({
  options,
  value,
  onChange,
  searchable = false,
  size = "default",
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: {
  options: readonly WzLegacyOption[];
  value: string;
  onChange: (value: string) => void;
  /** Workiz gives the long lists (service areas) a search box. */
  searchable?: boolean;
  /** `compact`: Finance Reporting's 26px box. Default: Job Statistics' 32px one. */
  size?: "default" | "compact";
  /** Shown as it is, never opens. */
  disabled?: boolean;
  /** Width of the closed box (`w-[244px]`). */
  className?: string;
  "aria-label": string;
}) {
  const compact = size === "compact";
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle))
    : options;
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  const show = () => {
    setQuery("");
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === value),
      ),
    );
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  const pick = (o: WzLegacyOption) => {
    onChange(o.value);
    close();
  };

  const keys = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) =>
        shown.length ? (a + step + shown.length) % shown.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = shown[Math.min(active, shown.length - 1)];
      if (o) pick(o);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div
      ref={rootRef}
      className={cn("relative inline-block align-top", compact ? "h-[26px]" : "h-8", className)}
      onKeyDown={keys}
    >
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-haspopup="listbox"
        aria-activedescendant={
          open && !searchable && shown.length ? optionId(active) : undefined
        }
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        className={cn(
          "flex w-full cursor-pointer items-center rounded-[2px] border border-input text-left text-[13px] leading-4 font-medium tracking-[0.5px] text-wz-text outline-none disabled:cursor-default",
          compact ? "h-[26px] pr-[22px]" : "h-8 pr-[26px]",
          "focus-visible:border-wz-focus",
          open ? "bg-background" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            compact ? "px-2 py-1" : "px-2.5 py-[7px]",
            open && searchable && "invisible",
          )}
        >
          {chosen?.label ?? ""}
        </span>
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-center border-l border-input",
            compact ? "w-9" : "w-[26px]",
          )}
        >
          {/* Finance Reporting's chevron is 13×7 (rep_commission_wz_06_mode_open). */}
          <ChevronDown className={cn("text-wz-text", compact ? "size-[26px]" : "size-4")} strokeWidth={compact ? 1 : 1.25} />
        </span>
      </button>
      {open && searchable ? (
        <input
          ref={searchRef}
          type="search"
          role="searchbox"
          aria-label="Search"
          placeholder="Search"
          aria-controls={listId}
          aria-activedescendant={shown.length ? optionId(active) : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          className={cn(
            "absolute top-px left-px bg-transparent tracking-[0.5px] text-wz-text outline-none placeholder:text-[#cccccc] [&::-webkit-search-cancel-button]:hidden",
            compact
              ? "h-6 w-[calc(100%-24px)] px-2 text-base"
              : "h-[30px] w-[calc(100%-28px)] px-2.5 text-[15px]",
          )}
        />
      ) : null}
      {open ? (
        <>
          {/* The caret the list hangs from: the top half of a turned square, over the list's edge. */}
          <span
            aria-hidden
            className={cn(
              "absolute left-[21px] z-50 h-2 w-[18px] overflow-hidden",
              compact ? "top-[30px]" : "top-[33px]",
            )}
          >
            <span className="absolute top-0.5 left-[3px] size-3 rotate-45 border-t border-l border-input bg-background" />
          </span>
          <div
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            className={cn(
              "absolute left-0 z-40 max-h-[calc(100vh-200px)] min-w-full overflow-y-auto border border-input bg-background",
              compact
                ? "top-[37px] rounded-[2px] shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)]"
                : "top-10 shadow-[0_1px_5px_rgba(0,0,0,0.25)]",
            )}
          >
            {shown.map((o, i) => {
              const on = o.value === value;
              return (
                <div
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={on}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pick(o)}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "cursor-pointer px-[15px] py-2.5 text-sm leading-4 font-medium tracking-[0.5px] whitespace-nowrap text-wz-text",
                    on
                      ? compact
                        ? "bg-[#ededed]"
                        : "bg-black/75"
                      : i === active
                        ? "bg-muted"
                        : "bg-background",
                  )}
                >
                  {o.label}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}
