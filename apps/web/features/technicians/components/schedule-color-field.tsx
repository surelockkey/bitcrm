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
 * Pick a colour for this technician, exactly the choice Workiz gives.
 *
 * Deliberately wired to nothing: the owner asked for the control now and the
 * meaning later ("поки ні до чого не прив'язуй"). So the choice lives in this
 * component and the line under it says plainly that it is not saved — a
 * swatch that looked stored and was not would be worse than no swatch.
 */
export function ScheduleColorField({ disabled = false }: { disabled?: boolean }) {
  const groupId = useId();
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <span id={groupId} className="text-sm font-medium">
        Schedule color
      </span>
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-1.5">
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
                "grid size-6 place-items-center rounded-full ring-offset-2 ring-offset-background transition-shadow",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                isPicked && "ring-2 ring-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
              style={{ backgroundColor: color }}
            >
              {isPicked ? <Check className="size-3.5 text-white drop-shadow" /> : null}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Not saved yet — the schedule colours a job by its status, so this needs a decision about
        which wins before it means anything.
      </p>
    </div>
  );
}
