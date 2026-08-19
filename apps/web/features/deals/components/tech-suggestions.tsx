"use client";

import { Check, Loader2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResolvedServiceArea } from "@/features/service-areas/hooks";
import { useSuggestedTechs } from "../hooks";
import type { IneligibilityReason, QualifiedTech } from "../api";

const REASON: Record<IneligibilityReason, string> = {
  not_assignable: "not currently assignable",
  missing_job_type: "can't do this job type",
  outside_area: "outside this service area",
};

const techName = (t: QualifiedTech) =>
  `${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || "Technician";

/**
 * Suggests technicians who can do a job while it's still being created — by its
 * job type and the service area its address resolves into. Eligible techs (right
 * job type + in area) are pickable; the rest show why they can't. Selection is
 * lifted so the page can assign them right after the job is created.
 */
export function TechSuggestions({
  jobTypeId,
  address,
  selected,
  onChange,
}: {
  jobTypeId: string;
  address: { lat?: number; lng?: number };
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data: area } = useResolvedServiceArea(address.lat, address.lng);
  const query = useSuggestedTechs(
    { jobTypeId, serviceAreaId: area?.id, lat: address.lat, lng: address.lng },
    Boolean(jobTypeId),
  );

  if (!jobTypeId) {
    return (
      <p className="text-xs text-muted-foreground">
        Pick a job type to see which technicians can do this job.
      </p>
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Finding technicians…
      </div>
    );
  }

  const techs = query.data ?? [];
  const eligible = techs.filter((t) => t.eligible);
  const others = techs.filter((t) => !t.eligible);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((t) => t !== id) : [...selected, id]);

  return (
    <div className="space-y-2">
      {eligible.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          No technician can do this job {area ? `in ${area.name}` : "here"} yet.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {eligible.map((t) => {
            const on = selected.includes(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => toggle(t.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "grid size-5 flex-none place-items-center rounded border",
                      on ? "border-brand bg-brand text-brand-foreground" : "border-input",
                    )}
                  >
                    {on ? <Check className="size-3.5" /> : null}
                  </span>
                  <UserRound className="size-4 flex-none text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">{techName(t)}</span>
                  {typeof t.distanceMiles === "number" ? (
                    <span className="text-xs text-muted-foreground">{t.distanceMiles.toFixed(1)} mi</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {others.length ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">
            {others.length} technician{others.length === 1 ? "" : "s"} can&apos;t take this job
          </summary>
          <ul className="divide-y border-t">
            {others.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                <UserRound className="size-4 flex-none" />
                <span className="flex-1">{techName(t)}</span>
                <span className="text-xs">{REASON[t.reasons[0]] ?? "not eligible"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
