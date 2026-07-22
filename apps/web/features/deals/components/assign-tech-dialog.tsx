"use client";

import { useMemo, useState } from "react";
import { Loader2, MapPin, Search, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/features/clients/lib";
import { useAssignTech, useQualifiedTechs } from "../hooks";
import type { IneligibilityReason, QualifiedTech } from "../api";

const REASON_LABEL: Record<IneligibilityReason, string> = {
  not_assignable: "Not yet assignable",
  missing_job_type: "Missing job type",
  outside_area: "Outside service area",
};

export function AssignTechDialog({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qualified = useQualifiedTechs(dealId, open);
  const assign = useAssignTech(dealId);
  const [search, setSearch] = useState("");

  const doAssign = (techId: string) =>
    assign.mutate(techId, { onSuccess: () => onOpenChange(false) });

  const techs = qualified.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return techs;
    return techs.filter((t) =>
      `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(s),
    );
  }, [techs, search]);

  // The endpoint returns everyone, eligible first; keep that split for headings.
  const eligible = filtered.filter((t) => t.eligible);
  const others = filtered.filter((t) => !t.eligible);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign technician</DialogTitle>
          <DialogDescription>
            Technicians approved for this job type and area come first, ranked by proximity.
            You can still assign anyone.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search technicians" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        {qualified.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Finding technicians…
          </div>
        ) : techs.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            No technicians are set up yet. Add technicians and approve their job types &amp;
            service areas to see ranked candidates here.
          </p>
        ) : (
          <>
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qualified</div>
              {eligible.length === 0 ? (
                <p className="py-1 text-xs text-muted-foreground">No one is approved for this job yet.</p>
              ) : (
                eligible.map((t) => (
                  <TechRow key={t.id} tech={t} pending={assign.isPending} onAssign={() => doAssign(t.id)} primary />
                ))
              )}
            </div>

            {others.length > 0 ? (
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other technicians</div>
                {others.map((t) => (
                  <TechRow key={t.id} tech={t} pending={assign.isPending} onAssign={() => doAssign(t.id)} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TechRow({
  tech,
  pending,
  onAssign,
  primary,
}: {
  tech: QualifiedTech;
  pending: boolean;
  onAssign: () => void;
  primary?: boolean;
}) {
  const name = `${tech.firstName ?? ""} ${tech.lastName ?? ""}`.trim() || tech.id;
  const parts = name.split(" ");
  const distance =
    typeof tech.distanceMiles === "number" ? `${tech.distanceMiles.toFixed(1)} mi from home` : null;

  return (
    <div className="flex items-center gap-2.5 rounded-lg border p-2">
      <span className="grid size-7 flex-none place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
        {initials(parts[0] ?? name, parts[1] ?? "")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          {primary && distance ? (
            <span className="flex items-center gap-1"><MapPin className="size-3" />{distance}</span>
          ) : null}
          {!primary
            ? tech.reasons.map((r) => (
                <Badge key={r} variant="secondary" className="font-normal">{REASON_LABEL[r]}</Badge>
              ))
            : null}
          {primary && !distance ? <span>Distance unknown — no home address on file</span> : null}
        </div>
      </div>
      <Button size="sm" variant={primary ? "brand" : "outline"} className="gap-1" disabled={pending} onClick={onAssign}>
        <UserPlus className="size-3.5" /> Assign
      </Button>
    </div>
  );
}
