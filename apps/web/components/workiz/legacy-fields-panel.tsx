"use client";

import { cn } from "@/lib/utils";

export interface WzLegacyField {
  id: string;
  label: string;
  on: boolean;
}

/**
 * Finance Reporting's "Fields" (Commissions, rep_commission_wz_07_fields_open,
 * _13_tech_fields, _15_external_fields): a grey box (#e3e5ea, 1px #ccc, r2,
 * 20px in) that slides open under the report's controls, a ✕ at its top
 * right, and every column as a 165×28 tile (1px #404040, r2) — its name
 * (11px/16px #4d4d4d, capitalised, cut at 87px, ":" after) and Developr's
 * "switch tiny" (35×15: #eac300 on, a pressed grey track off, a 19px knob
 * with three grip lines). Tiles flow 4px apart, rows 3px apart: seven to a
 * row at 1400px.
 *
 * Workiz saves each flip on its server per user; the caller decides where a
 * flip goes.
 */
export function WzLegacyFieldsPanel({
  fields,
  onToggle,
  onClose,
  className,
}: {
  fields: readonly WzLegacyField[];
  onToggle: (id: string) => void;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Fields"
      // #e3e5ea / #4d4d4d / #404040: the box, the names and the tiles (rep_commission_wz_07_fields_open).
      className={cn("relative rounded-[2px] border border-input bg-[#e3e5ea] p-5", className)}
    >
      <button
        type="button"
        aria-label="Hide fields"
        onClick={onClose}
        className="absolute top-[11px] right-4 size-4 cursor-pointer text-[20px] leading-4 text-wz-strong outline-none focus-visible:ring-1 focus-visible:ring-wz-strong"
      >
        ✕
      </button>
      <ul className="flex max-w-[1179px] flex-wrap gap-x-1 gap-y-[3px]">
        {fields.map((f) => (
          <li
            key={f.id}
            className="flex h-7 w-[165px] items-center justify-between rounded-[2px] border border-[#404040] py-[5px] pr-0 pl-[5px]"
          >
            <span className="w-[87px] truncate text-[11px] leading-4 tracking-[0.4px] text-[#4d4d4d] capitalize">{`${f.label}:`}</span>
            <LegacySwitch label={f.label} on={f.on} onClick={() => onToggle(f.id)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Developr's `switch tiny`: 35×15, the knob 2px proud of the track. */
function LegacySwitch({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={onClick}
      className={cn(
        "relative mr-[9px] h-[15px] w-[35px] shrink-0 cursor-pointer rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-wz-strong",
        // On: #eac300 (switch-on, = wz-primary-hover); off: the light pressed track (sampled #e8e8e8).
        on ? "bg-wz-primary-hover" : "bg-[#e8e8e8] shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute -top-0.5 flex size-[19px] items-center justify-center gap-px rounded-full border border-wz-frame bg-[#efeff4] shadow-[inset_0_1px_0_#fff,0_1px_3px_rgba(0,0,0,0.5)] transition-[left] duration-150",
          on ? "left-[17px]" : "-left-0.5",
        )}
      >
        <span className="h-1.5 w-px bg-wz-caption" />
        <span className="h-1.5 w-px bg-wz-caption" />
        <span className="h-1.5 w-px bg-wz-caption" />
      </span>
    </button>
  );
}
