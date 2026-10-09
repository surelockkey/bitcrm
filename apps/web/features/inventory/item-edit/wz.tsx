"use client";

/**
 * The Workiz look for the item Edit popups — sizes, colours and type measured
 * off Workiz's own "Edit Inventory item" / "Edit Item" modal with
 * getComputedStyle (scratch capture `workiz-styles.json`). Scoped to these
 * popups: every class here is local, nothing touches BitCRM's theme.
 *
 * Measured values (px): modal 900 wide, radius 16, padding 24, shadow
 * 0 3 9 rgba(0,0,0,.5), backdrop rgba(0,0,0,.3). Title 18/600 #3b4b52.
 * Inputs 48 tall, 1px #ccc, radius 4, text 16 #666, floating label 12/20
 * #8c8c8c at top 2 (16 at 15.2 while it stands in for a placeholder), focus
 * border #ffd400. Selects 49 tall with 36px indicators in #ccc. Category field
 * 40 tall, 1px #9ea6aa, notched 11px label, "Browse" 13/600 #6aa8ee on #f3f6f7.
 * Toggles 40×20, #50d58c on / #bbb off. Buttons 40 tall, radius 24, 13/600
 * #3b4b52 (Cancel 98 wide, Save 81) — Save on #fad400, Cancel outlined 1px
 * #3b4b52. Footer 80 tall,
 * padding 20, gap 16, shadow 0 0 5 rgba(50,50,50,.2).
 */

import { useId, useState, type ComponentProps, type ReactNode } from "react";
import {
  AlertDialog as AlertDialogPrimitive,
  Dialog as DialogPrimitive,
  Select as SelectPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import { ChevronDown, CircleHelp, Folder, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { workizFont } from "./workiz-font";

/* ------------------------------------------------------------------ *
 * Modal chrome
 * ------------------------------------------------------------------ */

/** Classes every Workiz popup shares: font, text colour, letter spacing, shadow. */
const MODAL_BASE =
  "fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-white text-[14px] leading-4 tracking-[0.4px] text-[#404040] shadow-[0_3px_9px_rgba(0,0,0,0.5)] outline-none [color-scheme:light] data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0";

export function WzOverlay() {
  return (
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
  );
}

/**
 * A Workiz popup: the dialog root, backdrop and white card. `className` sets
 * the size; the card never scrolls sideways — whatever is inside wraps,
 * truncates or scrolls down.
 */
export function WzDialog({
  open,
  onOpenChange,
  className,
  children,
  testId,
  onEscapeKeyDown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
  testId?: string;
  onEscapeKeyDown?: ComponentProps<typeof DialogPrimitive.Content>["onEscapeKeyDown"];
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <WzOverlay />
        <DialogPrimitive.Content
          data-testid={testId}
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          // Workiz opens with nothing focused. Radix would ring the × (the
          // first tabbable); the card takes focus instead, unless a field of
          // it asked for focus itself (autoFocus).
          onOpenAutoFocus={(e) => {
            const card = e.currentTarget as HTMLElement | null;
            if (card && !card.contains(document.activeElement)) {
              e.preventDefault();
              card.focus();
            }
          }}
          className={cn(MODAL_BASE, workizFont.className, "max-w-[calc(100vw-2rem)] overflow-x-hidden", className)}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Title (18/600, #3b4b52) with the × on the right, 24px above the body. */
export function WzHeader({ title, className }: { title: string; className?: string }) {
  return (
    <div className={cn("mb-6 flex min-w-0 items-start justify-between gap-4", className)}>
      <DialogPrimitive.Title className="min-w-0 truncate text-[18px] leading-[27px] font-semibold tracking-[0.4px] text-[#3b4b52]">
        {title}
      </DialogPrimitive.Title>
      <DialogPrimitive.Close
        aria-label="Close"
        className="mt-[5px] flex-none rounded-sm text-[#3b4b52] outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[#ffd400]"
      >
        <X className="size-[18px]" strokeWidth={2.25} />
      </DialogPrimitive.Close>
    </div>
  );
}

/** The sticky footer of the item popup: a white strip with a soft shadow above. */
export function WzFooter({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-testid="wz-footer"
      className={cn(
        "relative z-10 flex h-20 flex-none items-center justify-end gap-4 bg-white px-5 shadow-[0_0_5px_rgba(50,50,50,0.2)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

const BUTTON_VARIANTS = {
  primary: "bg-[#fad400] text-[#3b4b52] hover:bg-[#eac300] active:bg-[#dcb802]",
  secondary: "border border-[#3b4b52] bg-transparent text-[#3b4b52] hover:bg-[#3b4b52]/5",
  tertiary: "bg-transparent text-[#3b4b52] hover:bg-[#3b4b52]/5",
  danger: "bg-[#f45e44] text-white hover:bg-[#e04d33] active:bg-[#cc4129]",
} as const;

export function WzButton({
  variant = "primary",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_VARIANTS; loading?: boolean }) {
  return (
    <button
      type={type}
      data-variant={variant}
      disabled={disabled || loading}
      className={cn(
        "inline-flex h-10 flex-none items-center justify-center gap-1.5 rounded-[24px] px-6 text-[13px] leading-[19px] font-semibold tracking-[0.2px] whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#3b4b52]/40 disabled:pointer-events-none disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Fields
 * ------------------------------------------------------------------ */

const FIELD_BORDER =
  "rounded-[4px] border border-[#ccc] bg-white outline-none transition-colors focus:border-[#ffd400] focus-visible:border-[#ffd400]";

function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-[12px] leading-4 text-[#f45e44]">
      {error}
    </p>
  );
}

/**
 * Workiz's floating-label input: the label sits inside the 48px box as the
 * placeholder (16px) and moves to the top edge (12px) once the field has a
 * value or focus. `alwaysFloat` keeps it up — Workiz does that for the
 * item's own fields even while empty.
 */
export function FloatingInput({
  label,
  value,
  onChange,
  alwaysFloat = false,
  error,
  className,
  inputClassName,
  id: idProp,
  type = "text",
  disabled,
  readOnly,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  label: string;
  value: string;
  onChange: (value: string) => void;
  alwaysFloat?: boolean;
  error?: string;
  inputClassName?: string;
  type?: "text" | "number";
}) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const [focused, setFocused] = useState(false);
  const floated = alwaysFloat || focused || value !== "";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={cn(
            FIELD_BORDER,
            "block h-12 w-full min-w-0 px-2.5 pt-3 text-[16px] leading-4 text-[#666]",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            (disabled || readOnly) && "cursor-not-allowed bg-[#f7f7f7] text-[#999] focus:border-[#ccc]",
            error && "border-[#f45e44] focus:border-[#f45e44]",
            inputClassName,
          )}
          {...props}
        />
        <label
          htmlFor={id}
          data-floated={floated || undefined}
          className={cn(
            "pointer-events-none absolute left-[10.4px] max-w-[calc(100%-20px)] truncate tracking-[0.4px] text-[#8c8c8c] transition-all duration-150",
            // Size and line height together: a bare text size would drop a leading-* before it (tailwind-merge).
            floated ? "top-[2px] text-[12px]/5" : "top-[15.2px] text-[16px]/5",
          )}
        >
          {label}
        </label>
      </div>
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

/** Workiz's plain textarea: placeholder instead of a label, resizes down only. */
export function WzTextarea({
  value,
  onChange,
  className,
  error,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={cn(
          FIELD_BORDER,
          "block w-full min-w-0 resize-y px-3 py-2 text-[14px] leading-4 break-words text-[#666] placeholder:text-[#808080]",
          props.disabled && "cursor-not-allowed bg-[#f7f7f7] text-[#999]",
          error && "border-[#f45e44]",
          className,
        )}
        {...props}
      />
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

export interface WzOption {
  value: string;
  label: string;
}

/**
 * Workiz's select (react-select): 49px box; with a `label`, the label rides
 * the top edge (12px) over the chosen value (16px); empty, the placeholder
 * sits in the middle. On the right: × to clear (when `clearable` and set), a
 * 1px separator and the chevron, all #ccc. "" is no value.
 */
export function WzSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  clearable = false,
  disabled = false,
  className,
  menuClassName,
  "aria-label": ariaLabel,
}: {
  label?: string;
  placeholder: string;
  value: string;
  options: WzOption[];
  onChange: (value: string) => void;
  clearable?: boolean;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const hasValue = value !== "";
  return (
    <div className={cn("relative min-w-0", className)}>
      <SelectPrimitive.Root
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectPrimitive.Trigger
          aria-label={ariaLabel ?? label ?? placeholder}
          className={cn(
            FIELD_BORDER,
            "relative block h-[49px] w-full min-w-0 text-left data-[state=open]:border-[#ffd400]",
            disabled && "cursor-not-allowed bg-[#f2f2f2]",
          )}
        >
          {label && hasValue ? (
            <span className="pointer-events-none absolute top-[3px] left-2.5 max-w-[calc(100%-84px)] truncate text-[12px] leading-4 tracking-[0.4px] text-[#8c8c8c]">
              {label}
            </span>
          ) : null}
          <span
            className={cn(
              "pointer-events-none absolute left-2 truncate text-[16px] leading-4 tracking-[0.4px]",
              clearable && hasValue ? "right-[82px]" : "right-11",
              hasValue
                ? label
                  ? "top-[24px]"
                  : "top-1/2 -translate-y-1/2"
                : "top-1/2 -translate-y-1/2 text-[#808080]",
              hasValue && (disabled ? "text-[#999]" : "text-[#333]"),
            )}
          >
            <SelectPrimitive.Value placeholder={label ?? placeholder} />
          </span>
          <span aria-hidden className="absolute top-2 right-9 bottom-2 w-px bg-[#ccc]" />
          <SelectPrimitive.Icon
            className={cn(
              "absolute top-1/2 right-0 flex size-9 -translate-y-1/2 items-center justify-center",
              open ? "text-[#666]" : "text-[#ccc]",
            )}
          >
            <ChevronDown className="size-5" strokeWidth={1.75} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={8}
            className={cn(
              workizFont.className,
              "z-[60] max-h-[200px] w-(--radix-select-trigger-width) overflow-x-hidden overflow-y-auto rounded-[4px] bg-white py-1 shadow-[0_0_0_1px_hsla(0,0%,0%,0.1),0_4px_11px_hsla(0,0%,0%,0.1)]",
              menuClassName,
            )}
          >
            <SelectPrimitive.Viewport>
              {options.map((o) => (
                <SelectPrimitive.Item
                  key={o.value}
                  value={o.value}
                  className="cursor-default truncate px-3 py-2 text-[15px] leading-4 tracking-[0.4px] text-[#333] outline-none select-none data-highlighted:bg-[#deebff] data-[state=checked]:bg-[#2684ff] data-[state=checked]:text-white"
                >
                  <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {clearable && hasValue && !disabled ? (
        <button
          type="button"
          aria-label={`Clear ${label ?? placeholder}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onChange("")}
          className="absolute top-1/2 right-[37px] flex size-9 -translate-y-1/2 items-center justify-center text-[#ccc] hover:text-[#999]"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * "Choose category (optional)": a 40px field with a folder icon and a
 * "Browse" button inside. Empty, the label stands in the field; set, it
 * moves onto the top border (a notched outline) over the category's name.
 */
export function CategoryField({
  label,
  value,
  onBrowse,
  disabled = false,
}: {
  label: string;
  value: string;
  onBrowse: () => void;
  disabled?: boolean;
}) {
  const hasValue = value !== "";
  return (
    <div
      data-testid="category-field"
      onClick={disabled ? undefined : onBrowse}
      className={cn(
        "relative h-10 w-full min-w-0 rounded-[4px] border border-[#9ea6aa] bg-white",
        disabled ? "cursor-not-allowed bg-[#f7f7f7]" : "cursor-pointer",
      )}
    >
      {hasValue ? (
        <span className="pointer-events-none absolute -top-2 left-2 max-w-[calc(100%-16px)] truncate bg-white px-1 text-[11px] leading-[16.5px] tracking-[0.4px] text-[#3b4b52]">
          {label}
        </span>
      ) : null}
      <Folder
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-[15px] size-[18px] -translate-y-1/2 text-[#3b4b52]"
        strokeWidth={1.5}
      />
      <span
        title={hasValue ? value : undefined}
        className={cn(
          "pointer-events-none absolute top-1/2 right-[90px] left-11 -translate-y-1/2 truncate text-[13px] leading-4 tracking-[0.4px]",
          hasValue ? "text-[#3b4b52]" : "text-[#768287]",
        )}
      >
        {hasValue ? value : label}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-label={`Browse — ${label}`}
        onClick={(e) => {
          e.stopPropagation();
          onBrowse();
        }}
        className="absolute top-1 right-1 flex h-8 items-center rounded-[4px] bg-[#f3f6f7] px-3 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-[#6aa8ee] outline-none hover:text-[#3589e9] focus-visible:ring-2 focus-visible:ring-[#6aa8ee]/50 disabled:opacity-50"
      >
        Browse
      </button>
    </div>
  );
}

/** Workiz's toggle: 40×20 pill, green on, grey off, white 16px knob. */
export function WzToggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-10 flex-none rounded-[20px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[#50d58c]/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[#50d58c]" : "bg-[#bbb]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-[2px] size-4 rounded-full bg-white transition-[left] duration-150",
          checked ? "left-[22px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

/** A label on the left and a toggle on the right, 20px tall — one Workiz switch row. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
  info,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Text of the ⓘ tooltip beside the label. */
  info?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-5 min-w-0 items-center justify-between gap-3", className)}>
      <span className="flex min-w-0 items-center gap-1 text-[14px] leading-4 text-[#404040]">
        <span className="min-w-0 break-words">{label}</span>
        {info ? <InfoTip text={info} /> : null}
      </span>
      <WzToggle label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** ⓘ with Workiz's blue tooltip underneath. */
function InfoTip({ text }: { text: string }) {
  return (
    <TooltipPrimitive.Provider delayDuration={0}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          <button type="button" aria-label={text} className="flex-none text-[#404040]">
            <CircleHelp className="size-[18px]" strokeWidth={1.5} />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side="bottom"
            sideOffset={6}
            className={cn(
              workizFont.className,
              "z-[60] max-w-[264px] rounded-[4px] bg-[#3589e9] px-3 py-2 text-[12px] leading-[18px] tracking-[0.4px] text-white",
            )}
          >
            {text}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/** Workiz's small square checkbox with its label on the right. */
export function WzCheckbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 pl-[3px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="size-[13px] flex-none accent-[#3b4b52]"
      />
      <label htmlFor={id} className="text-[14px] leading-4 tracking-[0.4px] text-[#404040]">
        {label}
      </label>
    </div>
  );
}

/**
 * Workiz's confirm popup (440 wide): title, one line of text, then the
 * buttons — Cancel and a red "Yes, delete" by default.
 */
export function WzConfirm({
  open,
  onOpenChange,
  title,
  message,
  confirmText = "Yes, delete",
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: ReactNode;
  confirmText?: string;
  onConfirm: () => void;
  pending?: boolean;
}) {
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30" />
        <AlertDialogPrimitive.Content
          className={cn(MODAL_BASE, workizFont.className, "w-[440px] max-w-[calc(100vw-2rem)] overflow-x-hidden p-6")}
        >
          <AlertDialogPrimitive.Title className="text-[18px] leading-[27px] font-semibold tracking-[0.4px] break-words text-[#3b4b52]">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="mt-4 text-[16px] leading-6 break-words text-[#404040]">
            {message}
          </AlertDialogPrimitive.Description>
          <div className="mt-6 flex justify-end gap-4">
            <AlertDialogPrimitive.Cancel asChild>
              <WzButton variant="tertiary">Cancel</WzButton>
            </AlertDialogPrimitive.Cancel>
            <WzButton
              variant="danger"
              loading={pending}
              onClick={(e) => {
                e.preventDefault();
                onConfirm();
              }}
            >
              {confirmText}
            </WzButton>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
