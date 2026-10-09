"use client";

import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WzMiniToggle } from "./switch-tabs";

/**
 * A settings row with the switch BEFORE the words — Workiz's Security Center
 * (`feat_security_wz_security`) and Estimates settings rows: the 32×16
 * Toggle-module at the left (ON #3acf7d, OFF #768287, the 12px white knob
 * — `WzMiniToggle` as it is), the words 12px after it, 14px/21px 500
 * #3b4b52 (`secuirtySettings-module__optionsubtitle`), the hint right under
 * them 14px/21px #566d76. Rows stand 12px apart (54px pitch with a one-line
 * hint). Saves on flip: the caller's `onCheckedChange` is the write.
 *
 * Not `WzAccountToggle` (the Account page: 13px words, switch at the right
 * edge) nor `WzSwitchRow` (the permission editors).
 */
export function WzLeadToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const hintId = useId();
  return (
    <div data-slot="wz-lead-toggle-row" className={cn("flex items-start gap-3", className)}>
      <WzMiniToggle
        label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
      />
      <div className="min-w-0">
        <p className="text-sm leading-[21px] font-medium tracking-[0.4px] text-foreground">{label}</p>
        {hint ? (
          <p id={hintId} className="text-sm leading-[21px] tracking-[0.4px] text-wz-slate">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
