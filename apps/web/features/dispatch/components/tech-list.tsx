"use client";

import { Wrench } from "lucide-react";
import type { User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import {
  technicianStatus,
  formatAge,
  type TechnicianPosition,
  type TechStatus,
} from "../lib";

const DOT: Record<TechStatus, string> = {
  live: "bg-emerald-500",
  stale: "bg-amber-500",
  derived: "bg-zinc-400",
  offline: "bg-zinc-300",
};

/** Online first, then by name — the dispatcher cares about who's actually out there. */
const STATUS_ORDER: Record<TechStatus, number> = { live: 0, stale: 1, derived: 2, offline: 3 };

/** The status line, including how long ago a live fix arrived. */
function statusLabel(status: TechStatus, position: TechnicianPosition | undefined, now: number): string {
  const age = formatAge(position?.updatedAt, now);
  switch (status) {
    case "live":
      return `Online · ${age}`;
    case "stale":
      return `Last seen ${age}`;
    case "derived":
      return "No live GPS";
    case "offline":
      return "Offline · no location";
  }
}

function TechRow({
  userId,
  name,
  status,
  label,
  locatable,
  selected,
  hovered,
  onHover,
  onSelect,
}: {
  userId: string;
  name: string;
  status: TechStatus;
  label: string;
  locatable: boolean;
  selected: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      data-testid={`tech-row-${userId}`}
      data-hovered={hovered ? "true" : "false"}
      // Only a technician we can place has a marker to highlight / centre on.
      onMouseEnter={() => locatable && onHover(userId)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => locatable && onHover(userId)}
      onBlur={() => onHover(null)}
      onClick={() => locatable && onSelect(userId)}
      className={cn(
        "flex w-full items-center gap-2.5 border-b px-4 py-3 text-left transition-colors",
        locatable && "hover:bg-muted/60 focus-visible:bg-muted/60",
        (hovered || selected) && "bg-muted",
        selected && "ring-1 ring-inset ring-primary/40",
        "focus-visible:outline-none",
      )}
    >
      <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Wrench className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("size-2 rounded-full", DOT[status])} />
          {label}
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
  selectedId,
  onHover,
  onSelect,
}: {
  /** Every technician's userId, so offline ones appear too. */
  userIds: string[];
  positions: TechnicianPosition[];
  userMap: Map<string, User>;
  hoveredId: string | null;
  selectedId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(positions.map((p) => [p.userId, p]));
  const now = Date.now();

  const rows = userIds
    .map((userId) => {
      const position = byId.get(userId);
      const user = userMap.get(userId);
      const name = user
        ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
        : "Technician";
      const status = technicianStatus(position);
      return {
        userId,
        name,
        status,
        label: statusLabel(status, position, now),
        locatable: Boolean(position),
      };
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
          label={row.label}
          locatable={row.locatable}
          selected={selectedId === row.userId}
          hovered={hoveredId === row.userId}
          onHover={onHover}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
