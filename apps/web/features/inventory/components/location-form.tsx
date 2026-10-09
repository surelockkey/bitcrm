"use client";

import { useId, type ComponentProps, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Workiz's "Edit Location" / "Create New Location" popup
 * (workizModal-module, pg_inventory_wz_12_edit_location / _14_add_location):
 * 488px, 16px corners, 24px in; the h4 title, then the fields 26px apart —
 * the floating "Location Name" box and the "Description" box — and at the
 * bottom right Cancel and the yellow Save. Warehouses and vans both open it;
 * BitCRM's own fields (an address, a van's department, template, users,
 * status) follow Workiz's two in the same look.
 */
export function LocationDialog({
  open,
  onOpenChange,
  title,
  description,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** For screen readers: what the popup edits. */
  description: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid={testId}
        // Workiz opens its popups with nothing focused (Radix would select the name).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        className="flex max-h-[calc(100dvh-2rem)] w-[488px] flex-col gap-0 overflow-hidden sm:max-w-[488px]"
      >
        <DialogTitle className="shrink-0 truncate pr-8">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The fields, 25px under the title and 26px apart; the body scrolls when they outgrow the window. */
export function LocationFields({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-[25px] flex min-h-0 flex-col gap-[26px] overflow-y-auto", className)}>{children}</div>;
}

/** Cancel and Save (and BitCRM's Archive at the left) — 40px pills at the bottom right, 85px under the fields. */
export function LocationFooter({ children, start }: { children: ReactNode; start?: ReactNode }) {
  return (
    <div className="mt-[61px] flex shrink-0 items-center justify-end gap-4">
      {start ? <div className="mr-auto">{start}</div> : null}
      {children}
    </div>
  );
}

/** The sajInput box: 1px #9ea6aa, 5px corners, #666 words; the label floats to 12px at the top once there is a value or focus. */
const BOX =
  "peer block w-full rounded-[5px] border border-wz-outline bg-background px-2.5 text-foreground/80 outline-none placeholder:text-transparent hover:border-foreground focus:border-wz-focus disabled:cursor-not-allowed disabled:bg-muted disabled:text-wz-outline aria-invalid:border-wz-error";
const LABEL =
  "pointer-events-none absolute left-[11px] truncate text-[12px] leading-5 text-[#8c8c8c] transition-all duration-150 peer-placeholder-shown:text-[16px] peer-focus:text-[12px]";

/** Workiz's floating-label input — 48px, the words 12px down under the label. */
export function LocationInput({
  label,
  error,
  className,
  id: idProp,
  ...props
}: Omit<ComponentProps<"input">, "placeholder"> & { label: string; error?: string }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={cn("relative shrink-0", className)}>
      <input
        id={id}
        // A blank placeholder lets CSS know the box is empty (the label rests inside).
        placeholder=" "
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(BOX, "h-12 pt-3 text-base leading-4")}
        {...props}
      />
      <label
        htmlFor={id}
        className={cn(LABEL, "top-[2px] peer-placeholder-shown:top-[14px] peer-focus:top-[2px]")}
      >
        {label}
      </label>
      {error ? (
        <p id={`${id}-error`} className="mt-1 pl-3 text-xs leading-[10px] text-wz-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Workiz's floating-label description box — 132px, 14px/18.2px words 20px down. */
export function LocationTextarea({
  label,
  className,
  id: idProp,
  ...props
}: Omit<ComponentProps<"textarea">, "placeholder"> & { label: string }) {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <div className={cn("relative shrink-0", className)}>
      <textarea
        id={id}
        placeholder=" "
        className={cn(BOX, "h-[132px] resize-y pt-5 pb-2.5 text-sm leading-[18.2px]")}
        {...props}
      />
      <label
        htmlFor={id}
        className={cn(LABEL, "top-[2px] right-2.5 peer-placeholder-shown:top-[13px] peer-focus:top-[2px]")}
      >
        {label}
      </label>
    </div>
  );
}
