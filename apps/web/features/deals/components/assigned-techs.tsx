"use client";

import { X } from "lucide-react";
import type { DirectoryUser } from "../hooks";
import { initials } from "@/features/clients/lib";
import { cn } from "@/lib/utils";
import { useUserMap } from "../hooks";
import { personName } from "../person-name";

interface ChipProps {
  techIds: string[];
  onRemove?: (techId: string) => void;
  size?: "sm" | "xs";
  emptyText?: string | null;
  className?: string;
}

/**
 * Pure renderer for a deal's technician roster. Takes the user map so callers
 * that already hold one (card, table, summary) don't pay for a second query.
 */
export function TechChips({
  techIds,
  userMap,
  onRemove,
  size = "sm",
  emptyText = "Unassigned",
  className,
}: ChipProps & { userMap: Map<string, DirectoryUser> }) {
  if (!techIds.length) {
    return emptyText ? <span className="text-sm text-muted-foreground">{emptyText}</span> : null;
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {techIds.map((id) => {
        const u = userMap.get(id);
        // A uuid is not a name: while the directory is still on its way the
        // chip waits rather than printing the id.
        const name = personName(u);
        return (
          <span
            key={id}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-chip border bg-muted/50 pr-2",
              size === "xs" ? "text-[11px]" : "text-xs",
            )}
          >
            <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
              {initials(u?.firstName ?? "", u?.lastName ?? "")}
            </span>
            <span className={cn("font-medium", name ? "" : "min-w-16 animate-pulse rounded bg-muted text-transparent")}>
              {name ?? "\u00a0"}
            </span>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(id)}
                className="opacity-60 hover:opacity-100"
                aria-label={`Remove ${name ?? "technician"}`}
              >
                <X className="size-3" />
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Same chips, resolving names itself.
 *
 * Passes its own `techIds` down: a viewer who may not list users (a technician)
 * cannot fetch the directory, so the map is built from exactly these ids —
 * otherwise the chips render raw uuids.
 */
export function AssignedTechs(props: ChipProps) {
  const { map } = useUserMap(props.techIds);
  return <TechChips {...props} userMap={map} />;
}
