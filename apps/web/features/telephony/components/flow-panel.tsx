"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The builder's one editing surface: a sheet on the right, over a dimmed
 * canvas.
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
  children,
}: {
  title: string;
  onClose: () => void;
  footer?: React.ReactNode;
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
        className="absolute inset-0 z-40 cursor-default bg-foreground/20"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label={title}
        className="absolute inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l bg-background shadow-2xl"
      >
        <header className="relative flex-none border-b bg-muted/40 px-5 py-4">
          <h2 className="text-center text-base font-semibold">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer ? (
          <footer className="flex-none border-t px-5 py-4">{footer}</footer>
        ) : null}
      </aside>
    </>
  );
}

/** Cancel / confirm, side by side and equal — the panel's standard footing. */
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
    <div className="grid grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="rounded-full"
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button
        type="button"
        variant="brand"
        size="lg"
        className="rounded-full"
        disabled={confirmDisabled}
        onClick={onConfirm}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

/**
 * A label that sits inside the top of its field's border, the way the Workiz
 * panel does it — the value stays readable at a glance without a separate
 * line of label above every input.
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
    <div className="rounded-lg border px-3 pt-2 pb-1 focus-within:border-ring">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
