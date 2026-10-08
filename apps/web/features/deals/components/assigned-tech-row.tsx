"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { personName } from "../person-name";
import { techColor } from "../tech-color";

/**
 * One assigned technician, one row — the way Workiz lists a job's team.
 *
 * A line of chips had nowhere to put the things a dispatcher does with a
 * person: look them up, call them, message them, take them off the job. A row
 * does, so the buttons live here on the right and the caller decides which of
 * them this screen offers.
 *
 * The avatar carries the technician's own colour, derived from their id, so
 * the same person looks the same on every screen. A uuid is never shown: while
 * the directory is on its way the row waits.
 */
export function AssignedTechRow({
  techId,
  user,
  onRemove,
  children,
  className,
}: {
  techId: string;
  /** `workizName` ("(2) TX - Daniel Munoz") is what Workiz prints, when the import kept it. */
  user: { firstName?: string; lastName?: string; workizName?: string; email?: string } | undefined;
  onRemove?: (techId: string) => void;
  /** The buttons this screen offers for this person. */
  children?: React.ReactNode;
  className?: string;
}) {
  const name = personName(user);
  const initial = (user?.firstName ?? user?.lastName ?? "").trim().charAt(0).toUpperCase();

  return (
    // Workiz's `details-module__techRow`: a 35px round avatar, the name
    // centred beside it, then the 40px actions, which show once the row is
    // reached for. `group` is that hover.
    <div className={cn("group mb-2.5 flex", className)}>
      <span
        data-slot="tech-avatar"
        className={cn(
          "mr-2.5 grid size-[35px] shrink-0 place-items-center rounded-full text-[14px] leading-[35px] text-white",
          techColor(techId),
          name ? "" : "opacity-50",
        )}
      >
        {initial}
      </span>

      <div className="flex min-h-10 min-w-0 flex-1 flex-col justify-center text-[14px] leading-4 font-normal text-wz-strong">
        <span
          className={cn("truncate", name ? "" : "h-4 max-w-40 animate-pulse rounded bg-muted text-transparent")}
          title={name}
        >
          {name ?? " "}
        </span>
      </div>

      <div className="flex shrink-0 items-start">
        {children}
        {onRemove ? (
          <button
            type="button"
            aria-label={`Remove ${name ?? "technician"}`}
            title="Remove tech"
            onClick={() => onRemove(techId)}
            className={cn(TECH_ACTION, "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
          >
            <Trash2 className="size-[18px]" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One of a tech row's actions (`details-module__action`): 40px round, ink
 * glyph, a #ddd disc under the pointer (job_b_04 / jobdetails_wz_techrow_*).
 */
export const TECH_ACTION =
  "grid size-10 shrink-0 cursor-pointer place-items-center rounded-full text-foreground transition-all duration-300 hover:bg-[#dddddd] disabled:cursor-not-allowed";
