"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DeliveryWindowValue {
  /** Workiz "Automation will be sent": 24/7, or only inside a window. */
  deliveryWindow: "always" | "between";
  workingHours: { from: string; to: string };
  quietHours: "hold" | "skip" | "ignore";
}

/** `09:00` → `9:00 AM`, in the reader's own locale. */
export function formatWindowTime(value: string): string {
  const [h, m] = value.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return value;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function deliveryWindowLabel(value: DeliveryWindowValue): string {
  if (value.deliveryWindow === "always") return "24/7";
  return `${formatWindowTime(value.workingHours.from)} – ${formatWindowTime(value.workingHours.to)}`;
}

/**
 * "Automation will be sent 9:00 AM – 5:00 PM ⌄" — bottom left, where Workiz
 * keeps it (spec §2). It writes `timing.workingHours`, which the engine has
 * always honoured, and beside it what happens outside those hours, because a
 * window with no answer to that is a window that means nothing.
 */
export function DeliveryWindowControl({
  value,
  disabled,
  onChange,
}: {
  value: DeliveryWindowValue;
  disabled?: boolean;
  onChange: (next: DeliveryWindowValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // The selects inside this popover render in a portal of their own, so a
      // press on one of their options lands outside this box and would shut
      // the popover under the answer it was just given.
      if (box.current?.contains(target) || target?.closest("[data-radix-popper-content-wrapper]")) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div
      ref={box}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        // Workiz's footer field on the slate canvas (pg_automations_wz_31_edit):
        // "Automation will be sent" 13px/30px 500 #9ea6aa over "24/7 ⌄" —
        // 14px/23px 500 white and a #6aa8ee chevron.
        className={cn(
          "flex cursor-pointer flex-col items-start text-left outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
          "disabled:cursor-not-allowed",
        )}
      >
        <span className="text-[13px] leading-[30px] font-medium tracking-[0.4px] text-wz-outline">Automation will be sent</span>
        <span className="flex items-center gap-2 text-sm leading-[23px] font-medium tracking-[0.4px] text-white">
          {deliveryWindowLabel(value)}
          <ChevronDown className="size-5 text-wz-link" strokeWidth={1.5} />
        </span>
      </button>

      {open ? (
        // Workiz's MenuPopup, white with 8px corners and its soft two-part shadow,
        // opening above the field — here holding the window and what happens outside it.
        <div className="absolute bottom-full left-0 z-30 mb-2 w-80 space-y-3 rounded-[8px] bg-white p-4 text-foreground shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]">
          <div className="space-y-1.5">
            <Label>Automation will be sent</Label>
            <Select
              value={value.deliveryWindow}
              onValueChange={(v) =>
                onChange({
                  ...value,
                  deliveryWindow: v as DeliveryWindowValue["deliveryWindow"],
                  // "Send anyway" answers before the engine ever looks at the
                  // window, so the two together are a window that does
                  // nothing. Asking for one means asking for it to be kept.
                  ...(v === "between" && value.quietHours === "ignore" ? { quietHours: "hold" as const } : {}),
                })
              }
            >
              <SelectTrigger className="w-full" aria-label="Automation will be sent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">24/7</SelectItem>
                <SelectItem value="between">Custom window</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {value.deliveryWindow === "between" ? (
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="automation-window-from">From</Label>
                <Input
                  id="automation-window-from"
                  type="time"
                  className="w-32"
                  value={value.workingHours.from}
                  onChange={(e) => onChange({ ...value, workingHours: { ...value.workingHours, from: e.target.value } })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="automation-window-to">To</Label>
                <Input
                  id="automation-window-to"
                  type="time"
                  className="w-32"
                  value={value.workingHours.to}
                  onChange={(e) => onChange({ ...value, workingHours: { ...value.workingHours, to: e.target.value } })}
                />
              </div>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Outside those hours</Label>
            <Select
              value={value.quietHours}
              onValueChange={(v) => onChange({ ...value, quietHours: v as DeliveryWindowValue["quietHours"] })}
            >
              <SelectTrigger className="w-full" aria-label="Outside those hours">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hold">Hold until the window opens</SelectItem>
                <SelectItem value="skip">Skip the message</SelectItem>
                <SelectItem value="ignore" disabled={value.deliveryWindow === "between"}>
                  {value.deliveryWindow === "between" ? "Send anyway — not with a window" : "Send anyway"}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Also decides what happens in the workspace&apos;s quiet hours. Workiz holds — a message due
              outside the window goes out as soon as it opens again.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
