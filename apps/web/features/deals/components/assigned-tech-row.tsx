"use client";

import { X } from "lucide-react";
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
  user: { firstName?: string; lastName?: string; email?: string } | undefined;
  onRemove?: (techId: string) => void;
  /** The buttons this screen offers for this person. */
  children?: React.ReactNode;
  className?: string;
}) {
  const name = personName(user);
  const initial = (user?.firstName ?? user?.lastName ?? "").trim().charAt(0).toUpperCase();

  return (
    // `group` so the row's buttons can appear only when it is reached for.
    <div className={cn("group flex items-center gap-2.5 py-1.5", className)}>
      <span
        data-slot="tech-avatar"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white",
          techColor(techId),
          name ? "" : "opacity-50",
        )}
      >
        {initial}
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          name ? "" : "h-4 max-w-40 animate-pulse rounded bg-muted text-transparent",
        )}
        title={name}
      >
        {name ?? " "}
      </span>

      <div className="flex shrink-0 items-center gap-0.5">
        {children}
        {onRemove ? (
          <button
            type="button"
            aria-label={`Remove ${name ?? "technician"}`}
            onClick={() => onRemove(techId)}
            className="grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
