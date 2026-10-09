"use client";

import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/*
 * Workiz's ON / OFF switch (`.react-switch`, components_form_switch): the
 * Status column of every settings grid (uikit_wz_set_jobtypes, _servicearea,
 * _taxes, pg_settings_catalogs_wz_adgroups) and the Field Validation page
 * (pg_settings_catalogs_wz_managefields), measured off those captures:
 *
 *   slider  80×24, 3px corners; on #eac300 with "ON" 13px/16px 700 white
 *           15px in; off #ccc with "OFF" #404040 43px in.
 *   knob    32×26 (a pixel proud of the slider top and bottom), #efeff4
 *           under a 1px #e1e1e1 edge, a 4×4 grid of #9a9a9a dots in its
 *           middle; at the right when on, the left when off.
 *
 * It is not `WzSwitch` (the round green 40×20 Scheduled toggle) nor
 * `WzMiniToggle` (the map's 32×16 one).
 */
export interface WzOnOffSwitchProps extends Omit<ComponentProps<"input">, "type" | "onChange" | "checked"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function WzOnOffSwitch({ checked, onCheckedChange, disabled, className, ...rest }: WzOnOffSwitchProps) {
  return (
    <label
      data-slot="wz-on-off-switch"
      // The switch sits in a grid row that opens its record on a click; the
      // click on the switch is the switch's alone.
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "relative inline-block h-6 w-20 shrink-0 select-none align-top",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className,
      )}
    >
      <input
        {...rest}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="peer absolute inset-0 m-0 size-full cursor-[inherit] opacity-0"
      />
      <span
        aria-hidden
        className="absolute inset-0 rounded-[3px] bg-input transition-colors peer-checked:bg-wz-primary-hover peer-focus-visible:ring-2 peer-focus-visible:ring-wz-focus"
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-[4px] text-[13px] leading-4 font-bold tracking-[0.4px] uppercase",
          checked ? "left-[15px] text-white" : "left-[43px] text-wz-strong",
        )}
      >
        {checked ? "ON" : "OFF"}
      </span>
      <span
        aria-hidden
        className={cn(
          // #efeff4 / #e1e1e1 / #9a9a9a: the knob's own greys, sampled off
          // pg_settings_catalogs_wz_managefields (one-offs, not tokens).
          "pointer-events-none absolute -top-px grid h-[26px] w-8 place-items-center border border-[#e1e1e1] bg-[#efeff4] transition-[left] duration-200",
          checked ? "left-12" : "left-0",
        )}
      >
        <span className="block size-[10px] bg-[radial-gradient(circle,#9a9a9a_0.75px,transparent_0.9px)] bg-[length:2.5px_2.5px]" />
      </span>
    </label>
  );
}
