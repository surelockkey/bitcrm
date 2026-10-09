"use client";

import { X } from "lucide-react";
import { WzButton } from "@/components/workiz/button";
import { cn } from "@/lib/utils";

/**
 * The builder's one editing surface: Workiz's right pane over a dimmed
 * canvas (pg_settings_phone_wz_builder_basic / _hours / _forward /
 * _add_open) — 400px of white from the right edge, a 48px head with the
 * title 18px 600 centred and a thin × at the right, the body 15px in, and
 * Cancel / Save pills sharing a 65px foot.
 *
 * Everything configurable lives here — the flow's name and numbers, a step's
 * settings, the list of steps you can add — because the canvas is a picture of
 * the call and stops being one the moment it also has form fields on it. Same
 * chrome every time, so wherever you opened it from, closing it is in the same
 * place.
 */
export function FlowPanel({
  title,
  onClose,
  footer,
  bodyClassName,
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Dimming the canvas is what makes the sheet read as "on top of" the
          flow rather than beside it — and clicking out is the fastest way
          back, so the scrim is the button. */}
      <button
        type="button"
        aria-label="Close panel"
        className="absolute inset-0 z-40 cursor-default bg-wz-scrim/60"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={title}
        className="absolute inset-y-0 right-0 z-50 flex w-[400px] max-w-full flex-col bg-white shadow-[-4px_0_8px_rgba(0,0,0,0.12)]"
      >
        <header className="relative flex h-12 flex-none items-center justify-center border-b border-[#eeeeee] px-10">
          <h2 className="truncate text-lg leading-[27px] font-semibold tracking-[0.4px] text-foreground">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute top-1/2 right-[13px] grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-[4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <X className="size-[18px]" strokeWidth={1.25} />
          </button>
        </header>

        <div className={cn("min-h-0 flex-1 overflow-y-auto px-[15px] py-7", bodyClassName)}>{children}</div>

        {footer ? <footer className="flex-none bg-white px-5 py-[15px]">{footer}</footer> : null}
      </aside>
    </>
  );
}

/** Cancel / confirm, side by side and equal — Workiz's pane foot (173×35 pills, 16px apart). */
export function PanelActions({
  cancelLabel = "Cancel",
  confirmLabel,
  onCancel,
  onConfirm,
  confirmDisabled,
}: {
  cancelLabel?: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <WzButton variant="secondary" size="regular" className="h-[35px]" onClick={onCancel}>
        {cancelLabel}
      </WzButton>
      <WzButton size="regular" className="h-[35px]" disabled={confirmDisabled} onClick={onConfirm}>
        {confirmLabel}
      </WzButton>
    </div>
  );
}

/**
 * Workiz's boxed field in the pane ("Flow Name", `sajInput`): 48px, 1px #ccc,
 * 2px corners, the label 12px/20px #8c8c8c at the top 10px in, the value
 * 16px #666 under it — readable at a glance without a line of label above.
 */
export function FloatingField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-12 rounded-[2px] border border-input bg-white px-2.5 pt-0.5 pb-1 focus-within:border-wz-focus">
      <label htmlFor={htmlFor} className="block text-xs leading-5 tracking-[0.4px] text-wz-label">
        {label}
      </label>
      {children}
    </div>
  );
}
