"use client";

import { useId, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The 39 colours Workiz offers on the technician card, read off their live
 * page (`ColorInput`, `app.workiz.com/root/editUser/460479`) in their order —
 * greens and blues first, then earth, then reds, then the neutrals.
 */
export const SCHEDULE_COLORS = [
  "#7FFFD4", "#1E90FF", "#6495ED", "#008B8B", "#5F9EA0", "#00008B", "#2E8B57",
  "#556B2F", "#8FBC8F", "#9ACD32", "#BDB76B", "#808000", "#DEB887", "#D2B48C",
  "#CD853F", "#B8860B", "#D2691E", "#A52A2A", "#FFA500", "#FF8C00", "#FF6347",
  "#FF4500", "#DC143C", "#8B0000", "#EE82EE", "#DA70D6", "#DB7093", "#BC8F8F",
  "#8A2BE2", "#191970", "#3CB371", "#008000", "#20B2AA", "#4169E1", "#2F4F4F",
  "#708090", "#F0E68C", "#000000", "#5E5E5E",
] as const;

/**
 * Pick a colour for this technician, exactly the choice Workiz gives, drawn as
 * Workiz draws it (ColorInput-module, pg_technicians_wz_10_user_profile): 32px
 * discs 8px apart, twelve to a 480px row; the picked one a white disc in a
 * 1px ring of its colour round a 26px disc of it, ticked.
 *
 * Deliberately wired to nothing: the owner asked for the control now and the
 * meaning later ("поки ні до чого не прив'язуй"). So the choice lives in this
 * component and the line under it says plainly that it is not saved — a
 * swatch that looked stored and was not would be worse than no swatch.
 */
export function ScheduleColorField({ disabled = false, labelledBy }: { disabled?: boolean; labelledBy?: string }) {
  const noteId = useId();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div>
      <div role="radiogroup" aria-labelledby={labelledBy} aria-describedby={noteId} className="flex w-[480px] max-w-full flex-wrap gap-2">
        {SCHEDULE_COLORS.map((color) => {
          const isPicked = picked === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={isPicked}
              aria-label={color}
              disabled={disabled}
              onClick={() => setPicked(isPicked ? null : color)}
              className={cn(
                "grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-wz-focus",
                isPicked && "border bg-white",
                disabled && "cursor-not-allowed opacity-50",
              )}
              style={isPicked ? { borderColor: color } : { backgroundColor: color }}
            >
              {isPicked ? (
                <span className="grid size-[26px] place-items-center rounded-full" style={{ backgroundColor: color }}>
                  <Check className="size-4 text-white drop-shadow" strokeWidth={3} />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p id={noteId} className="mt-2 text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">
        Not saved yet — the schedule colours a job by its status, so this needs a decision about which wins before it
        means anything.
      </p>
    </div>
  );
}
