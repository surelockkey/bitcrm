"use client";

import { cn } from "@/lib/utils";
import { personName } from "@/features/deals/person-name";
import type { DirectoryUser } from "@/features/deals/hooks";
import {
  technicianStatus,
  formatAge,
  type TechnicianPosition,
  type TechStatus,
} from "../lib";

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

export interface TechRow {
  userId: string;
  name: string;
  status: TechStatus;
  label: string;
  locatable: boolean;
}

/**
 * The Techs tab's people: everyone on the roster, online or not — a
 * technician with no live fix and no derived spot still belongs on the team
 * list, just marked offline — narrowed by the search box.
 */
export function techRows({
  userIds,
  positions,
  userMap,
  now,
  query = "",
}: {
  /** Every technician's userId, so offline ones appear too. */
  userIds: string[];
  positions: TechnicianPosition[];
  userMap: Map<string, DirectoryUser>;
  /** What a live fix's age is counted from: when the fixes were read. */
  now: number;
  query?: string;
}): TechRow[] {
  const byId = new Map(positions.map((p) => [p.userId, p]));
  const q = query.trim().toLowerCase();
  return userIds
    .map((userId) => {
      const position = byId.get(userId);
      const status = technicianStatus(position);
      return {
        userId,
        name: personName(userMap.get(userId)) ?? "Technician",
        status,
        label: statusLabel(status, position, now),
        locatable: Boolean(position),
      };
    })
    .filter((row) => !q || row.name.toLowerCase().includes(q))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
}

/*
 * The Map's tech cards (pg_dispatch_wz_11_techs): 16px in, a #dfe2e3 rule,
 * the name 14px/16px semibold. Ours adds the live status and the street under
 * it in the sidebar's slate 13px — Workiz keeps those for the pin's card.
 */
export function TechList({
  rows,
  addresses,
  hoveredId,
  onHover,
  onSelect,
}: {
  rows: TechRow[];
  /**
   * userId → the street they are on. Looked up by the page with everything
   * else it shows, so each row is drawn with its address line rather than
   * growing one when the lookup lands.
   */
  addresses: Map<string, string>;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {rows.map((row) => {
        const address = addresses.get(row.userId);
        return (
          <button
            key={row.userId}
            type="button"
            data-testid={`tech-row-${row.userId}`}
            data-hovered={hoveredId === row.userId ? "true" : "false"}
            // Only a technician we can place has a pin to point at / centre on.
            onMouseEnter={() => row.locatable && onHover(row.userId)}
            onMouseLeave={() => onHover(null)}
            onFocus={() => row.locatable && onHover(row.userId)}
            onBlur={() => onHover(null)}
            onClick={() => row.locatable && onSelect(row.userId)}
            className={cn(
              "flex w-full flex-col gap-1 border-b border-border p-4 text-left tracking-[0.4px] outline-none focus-visible:bg-wz-secondary-hover",
              row.locatable ? "cursor-pointer" : "cursor-default",
            )}
          >
            <span className="text-sm leading-4 font-semibold text-wz-strong">{row.name}</span>
            <span className="text-[13px] leading-[19px] text-wz-slate">{row.label}</span>
            {address ? <span className="truncate text-[13px] leading-[19px] text-wz-slate">{address}</span> : null}
          </button>
        );
      })}
    </>
  );
}
