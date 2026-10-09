"use client";

import { cn } from "@/lib/utils";

/**
 * Workiz's old react-switch (reactCss.css `.react-switch`; User locations'
 * "Restricted", pg_inventory_wz_02_user-locations): a 130×24 bar with 3px
 * corners, #ccc off and #eac300 on (.4s); a 30px #efeff4 knob with a 1px
 * #e1e1e1 edge at the left, moved 100px right when on; the word ("NO" /
 * "YES", 12px bold capitals, ink — white on yellow) on the bar 55px from its
 * right edge. Disabled, it greys and takes no clicks. A real switch: Space
 * and Enter flip it, its name is `label`.
 */
export function WzWideSwitch({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  onText = "Yes",
  offText = "No",
  className,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  onText?: string;
  offText?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-block h-6 w-[130px] shrink-0 cursor-pointer rounded-[3px] transition-colors duration-[400ms] outline-none focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-60",
        checked ? "bg-[#eac300]" : "bg-[#cccccc]",
        className,
      )}
    >
      <span
        data-slot="wz-wide-switch-knob"
        aria-hidden
        className={cn(
          "absolute top-0 left-0 h-full w-[30px] bg-[#efeff4] outline outline-1 outline-[#e1e1e1] transition-transform duration-300 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]",
          checked && "translate-x-[100px]",
        )}
      />
      <span
        className={cn(
          "absolute top-[5px] right-[55px] translate-x-1/2 text-xs leading-4 font-bold uppercase",
          checked ? "text-white" : "text-wz-strong",
        )}
      >
        {checked ? onText : offText}
      </span>
    </button>
  );
}
