"use client";

import { Wrench } from "lucide-react";
import type { User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { technicianStatus, type TechnicianPosition, type TechStatus } from "../lib";

const STATUS_META: Record<TechStatus, { label: string; dot: string }> = {
  live: { label: "Online", dot: "bg-emerald-500" },
  stale: { label: "Online · stale", dot: "bg-amber-500" },
  derived: { label: "No live GPS", dot: "bg-zinc-400" },
  offline: { label: "Offline · no location", dot: "bg-zinc-300" },
};

/** Online first, then by name — the dispatcher cares about who's actually out there. */
const STATUS_ORDER: Record<TechStatus, number> = { live: 0, stale: 1, derived: 2, offline: 3 };

function TechRow({
  userId,
  name,
  status,
  locatable,
  hovered,
  onHover,
}: {
  userId: string;
  name: string;
  status: TechStatus;
  locatable: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const meta = STATUS_META[status];
  return (
    <button
      type="button"
      data-testid={`tech-row-${userId}`}
      data-hovered={hovered ? "true" : "false"}
      // Only a technician we can place has a marker to highlight.
      onMouseEnter={() => locatable && onHover(userId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => locatable && onHover(userId)}
      onBlur={() => onHover(null)}
      className={cn(
        "flex w-full items-center gap-2.5 border-b px-4 py-3 text-left transition-colors",
        locatable && "hover:bg-muted/60 focus-visible:bg-muted/60",
        hovered && "bg-muted",
        "focus-visible:outline-none",
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Wrench className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", meta.dot)} />
          {meta.label}
        </div>
      </div>
    </button>
  );
}

/**
 * The technician roster for the map's "Techs" view. Shows everyone, online or
 * not — a technician with no live fix and no derived spot still belongs on the
 * team list, just marked offline. Hovering a locatable row highlights their map
 * marker.
 */
export function TechList({
  userIds,
  positions,
  userMap,
  hoveredId,
  onHover,
}: {
  /** Every technician's userId, so offline ones appear too. */
  userIds: string[];
  positions: TechnicianPosition[];
  userMap: Map<string, User>;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}) {
  const byId = new Map(positions.map((p) => [p.userId, p]));

  const rows = userIds
    .map((userId) => {
      const position = byId.get(userId);
      const user = userMap.get(userId);
      const name = user
        ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
        : "Technician";
      return { userId, name, status: technicianStatus(position), locatable: Boolean(position) };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No technicians.
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {rows.map((row) => (
        <TechRow
          key={row.userId}
          userId={row.userId}
          name={row.name}
          status={row.status}
          locatable={row.locatable}
          hovered={hoveredId === row.userId}
          onHover={onHover}
        />
      ))}
    </div>
  );
}
