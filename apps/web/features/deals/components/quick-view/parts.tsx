"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The quick view's small parts, measured from Workiz's pane
 * (quickview_wz_open / _details_expanded_bottom .styles.json, 2026-10-14):
 * content 24px in from a 440px pane (392px wide), 10px/500 grey uppercase
 * labels, 14px/400/21px ink values, 14px/600/21px section titles, 24px icon
 * buttons, 1px #e5e7eb rules between blocks.
 */

/** "STATUS", "CLIENT", "JOB TYPE", "TAGS": 10px/500/14px #768287, uppercase. */
export function QvLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <small className={cn("block text-[10px] leading-[14px] font-medium tracking-[0.4px] text-[#768287] uppercase", className)}>{children}</small>;
}

/** A value under a label: 14px/400/21px ink. */
export function QvValue({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[14px] leading-[21px] text-[#3b4b52]", className)}>{children}</p>;
}

/** "Schedule job", "Team", "Description": 14px/600/21px ink. */
export function QvTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[14px] leading-[21px] font-semibold text-[#3b4b52]", className)}>{children}</p>;
}

/** Workiz's 24px icon button (r4, #f3f6f7 while hovered or active); the pencils and the plus. */
export function QvIconButton({
  label,
  icon,
  onClick,
  className,
  active,
}: {
  label: string;
  icon: "pencil" | "plus";
  onClick: () => void;
  className?: string;
  active?: boolean;
}) {
  const Icon = icon === "pencil" ? Pencil : Plus;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-[4px] text-[#6aa8ee] hover:bg-[#f3f6f7]",
        active && "bg-[#f3f6f7]",
        className,
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}

/** Cancel (white) and Save (yellow) pills: 32px, 13px/600 ink, r20 — Workiz's regular Button. */
export function QvButtons({
  onCancel,
  onSave,
  saving,
  saveDisabled,
  className,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-8 items-center rounded-pill bg-white px-4 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-[#3b4b52] hover:bg-[#f3f6f7]"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={saving || saveDisabled}
        className="inline-flex h-8 items-center rounded-pill bg-[#fad400] px-4 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-[#3b4b52] hover:bg-[#eac300] disabled:bg-[#dfe2e3] disabled:hover:bg-[#dfe2e3]"
      >
        Save
      </button>
    </div>
  );
}

/**
 * A block that folds (Notes, Finance): the chevron and the title are one
 * button named by the title; `action` sits at the right edge (the "+").
 */
export function QvFold({
  title,
  action,
  children,
  defaultOpen = false,
  open: controlled,
  onOpenChange,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const set = (next: boolean) => {
    setOwn(next);
    onOpenChange?.(next);
  };
  const id = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <section className={cn("border-t border-[#e5e7eb] px-6 pt-6 pb-2", className)}>
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => set(!open)}
          className="flex items-center gap-2 rounded-[4px] text-left"
        >
          <span className="grid size-6 place-items-center rounded-[4px] text-[#3b4b52]">
            <Chevron className="size-4" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-[14px] leading-[21px] font-semibold text-[#3b4b52]">{title}</span>
        </button>
        {action}
      </div>
      {open ? (
        <div id={id} className="pt-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Workiz's 40px box with the floating 11px label on its top edge
 * (FloatingLabel-module + Input-module, quickview_wz_details_expanded_bottom):
 * 13px/16px ink, 1px #9ea6aa, r4, 12px in; disabled keeps white and greys
 * the edge (#bfc4c7) — never a grey fill.
 */
export function QvFloatField({
  label,
  value,
  onChange,
  onCommit,
  disabled,
  inputMode = "decimal",
  className,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  /** Enter or leaving the box. */
  onCommit?: () => void;
  disabled?: boolean;
  inputMode?: "decimal" | "text";
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("relative h-10 w-[188px]", className)}>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-10 w-full rounded-[4px] border border-[#9ea6aa] bg-white pr-2 pl-3 text-[13px] leading-4 text-[#3b4b52] outline-none focus:border-[#3b4b52] disabled:border-[#bfc4c7] disabled:bg-white disabled:text-[#1f2937]"
      />
      <label htmlFor={id} className="pointer-events-none absolute -top-2 left-2 bg-white px-1 text-[11px] leading-[17px] text-[#1f2937]">
        {label}
      </label>
    </div>
  );
}
