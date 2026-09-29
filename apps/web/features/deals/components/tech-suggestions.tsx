"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, UserRound, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResolvedServiceArea } from "@/features/service-areas/hooks";
import { useSuggestedTechs, useUserMap } from "../hooks";
import { personName } from "../person-name";
import type { IneligibilityReason, QualifiedTech } from "../api";

const REASON: Record<IneligibilityReason, string> = {
  // Dispatch holds a row for them but user-service says they are off the
  // field team — say that, rather than implying they are mid-onboarding.
  not_assignable: "not on the field team",
  missing_job_type: "can't do this job type",
  outside_area: "outside this service area",
};

const techName = (t: QualifiedTech) =>
  `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || "Technician";

/**
 * Workiz-style "Assign team members" select. States:
 * - no address → disabled, "Enter the address first" (techs need a service area);
 * - address, no job type → techs who can do ANY job type in the area, counted;
 * - address + job type → techs who can do THIS job, counted.
 * Eligible techs are pickable; the rest show why they can't.
 */
export function TechSuggestions({
  jobTypeId,
  address,
  selected,
  hideSelected = false,
  onChange,
}: {
  jobTypeId: string;
  address: { lat?: number; lng?: number };
  selected: string[];
  /** The team is listed above by TeamSection, so the trigger only invites. */
  hideSelected?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasAddress = address.lat !== undefined && address.lng !== undefined;
  const { data: area } = useResolvedServiceArea(address.lat, address.lng);
  const query = useSuggestedTechs(
    { jobTypeId: jobTypeId || undefined, serviceAreaId: area?.id, lat: address.lat, lng: address.lng },
    hasAddress,
  );

  const techs = query.data ?? [];
  const eligible = techs.filter((t) => t.eligible);
  const others = techs.filter((t) => !t.eligible);
  const byId = new Map(techs.map((t) => [t.id, t]));
  // A technician assigned to a job need not be eligible for it — an imported
  // one usually is not, having no approved job types yet — so the name comes
  // from the directory, which knows everyone, and never from the uuid.
  const { map: directory } = useUserMap(selected);
  const nameOf = (id: string) => {
    const t = byId.get(id);
    return (t ? techName(t) : undefined) ?? personName(directory.get(id));
  };

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]);

  // Trigger content: disabled ask-for-address, or chips / placeholder.
  const triggerText = !hasAddress
    ? "Enter the address first"
    : hideSelected || selected.length === 0
      ? "Assign a tech"
      : "";

  const summary = !hasAddress
    ? null
    : query.isLoading
      ? "Finding technicians…"
      : jobTypeId
        ? `${eligible.length} can do this job${area ? ` in ${area.name}` : ""}`
        : `${eligible.length} technician${eligible.length === 1 ? "" : "s"} can do any job type${area ? ` in ${area.name}` : ""}`;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <button
          type="button"
          aria-label="Assign team members"
          aria-expanded={open}
          disabled={!hasAddress}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex min-h-9 w-full items-center gap-1.5 rounded-md border bg-transparent px-2 py-1 text-left text-sm",
            !hasAddress ? "cursor-not-allowed text-muted-foreground opacity-70" : "hover:border-border/80",
          )}
        >
          <span className="flex flex-1 flex-wrap items-center gap-1">
            {triggerText ? (
              <span className={hasAddress && selected.length === 0 ? "text-muted-foreground" : ""}>{triggerText}</span>
            ) : (
              selected.map((id) => {
                const label = nameOf(id);
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-chip border bg-muted/50 px-2 py-0.5 text-xs">
                    <UserRound className="size-3" />
                    <span className={label ? "" : "min-w-14 animate-pulse rounded bg-muted text-transparent"}>
                      {label ?? "\u00a0"}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${label ?? "technician"}`}
                      onClick={(e) => { e.stopPropagation(); toggle(id); }}
                      className="opacity-70 hover:opacity-100"
                    >
                      <X className="size-3" />
                    </span>
                  </span>
                );
              })
            )}
          </span>
          <ChevronsUpDown className="size-4 flex-none text-muted-foreground" />
        </button>

        {open && hasAddress ? (
          <>
            <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-md">
              {query.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Finding technicians…
                </div>
              ) : eligible.length === 0 ? (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No technician can do this job {area ? `in ${area.name}` : "here"} yet.
                </p>
              ) : (
                eligible.map((t) => {
                  const on = selected.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggle(t.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50"
                    >
                      <span className={cn("grid size-5 flex-none place-items-center rounded border", on ? "border-brand bg-brand text-brand-foreground" : "border-input")}>
                        {on ? <Check className="size-3.5" /> : null}
                      </span>
                      <UserRound className="size-4 flex-none text-muted-foreground" />
                      <span className="flex-1 text-sm font-medium">{techName(t)}</span>
                      {typeof t.distanceMiles === "number" ? (
                        <span className="text-xs text-muted-foreground">{t.distanceMiles.toFixed(1)} mi</span>
                      ) : null}
                    </button>
                  );
                })
              )}

              {others.length ? (
                <div className="border-t">
                  <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">Can&apos;t take this job</p>
                  {others.map((t) => (
                    <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
                      <UserRound className="size-4 flex-none" />
                      <span className="flex-1">{techName(t)}</span>
                      <span className="text-xs">{REASON[t.reasons[0]] ?? "not eligible"}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {summary ? <p className="text-xs text-muted-foreground">{summary}</p> : null}
    </div>
  );
}
