"use client";

import { useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Workiz's `_picker` select — the "By: Job end date ⌄" row the Jobs report
 * hangs under its date box (rep_jobs_wz_01_default, _07_by_open): the prefix
 * and the choice in one 36px row (14px #404040, 10px in), a thin chevron
 * 29px from the right edge; a click hangs the choices under it as 37px rows
 * between 1px #ddd rules (#e1e1e1 under the cursor), as the date box's
 * presets hang. `attached` (default) drops its top edge to sit flush under
 * the date box; the caller gives both the same width.
 */
export function WzPickerSelect<V extends string>({
  prefix,
  options,
  value,
  onChange,
  attached = true,
  className,
}: {
  /** The word before the choice, and the list's name: "By". */
  prefix: string;
  options: readonly { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  /** Sits under another `_picker` box: no top edge of its own. */
  attached?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const label = options.find((o) => o.value === value)?.label ?? "";

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const pick = (v: V) => {
    setOpen(false);
    if (v !== value) onChange(v);
  };

  return (
    <div
      ref={rootRef}
      data-slot="wz-picker-select"
      className={cn(
        "relative border border-wz-frame bg-background text-sm leading-4 text-wz-strong",
        attached && "border-t-0",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-label={`${prefix}: ${label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        className="relative block w-full cursor-pointer p-2.5 pr-12 text-left whitespace-nowrap"
      >
        {prefix}: {label}
        {/* Workiz's `wfi-down` glyph: 12×7, 3px under the words' top. */}
        <svg
          aria-hidden
          width="13"
          height="8"
          viewBox="0 0 13 8"
          fill="none"
          className="absolute top-[17px] right-[29px]"
        >
          <path d="M.75.75 6.5 6.75 12.25.75" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={prefix}
          className="absolute top-full -right-px -left-px z-30 border border-wz-frame bg-background"
        >
          {options.map((o) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              tabIndex={-1}
              onClick={() => pick(o.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pick(o.value);
                }
              }}
              // rep_jobs_wz_06b_date_hover: the row under the cursor is #e1e1e1.
              className="cursor-pointer border-t border-wz-frame p-2.5 outline-none first:border-t-0 hover:bg-[#e1e1e1] focus-visible:bg-[#e1e1e1]"
            >
              {o.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
