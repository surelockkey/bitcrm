"use client";

import { useMemo, useState } from "react";
import { Loader2, MapPin, Search, UserPlus } from "lucide-react";
import type { User } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TECHNICIAN_ROLE_ID } from "@/lib/permissions/system-roles";
import { initials } from "@/features/clients/lib";
import { useAssignTech, useQualifiedTechs, useUserMap } from "../hooks";

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
  const { users } = useUserMap();
  const assign = useAssignTech(dealId);
  const [search, setSearch] = useState("");

  const allTechs = useMemo(
    () => users.filter((u) => u.roleId === TECHNICIAN_ROLE_ID),
    [users],
  );
  const filteredTechs = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return allTechs;
    return allTechs.filter((u) => `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(s));
  }, [allTechs, search]);

  const doAssign = (techId: string) =>
    assign.mutate(techId, { onSuccess: () => onOpenChange(false) });

  const qualifiedList = qualified.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign technician</DialogTitle>
          <DialogDescription>Ranked by proximity to the job. Pick anyone if the qualified list is empty.</DialogDescription>
        </DialogHeader>

        {/* Qualified list (empty today until tech profiles + wiring land) */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qualified</div>
          {qualified.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Finding technicians…</div>
          ) : qualifiedList.length === 0 ? (
            <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              No qualified technicians yet — this needs technician skills, service areas, and home location captured on their profiles. Assign anyone below in the meantime.
            </div>
          ) : (
            qualifiedList.map((t) => (
              <TechRow
                key={t.id}
                name={`${t.firstName ?? ""} ${t.lastName ?? ""}`.trim() || t.email || t.id}
                sub={typeof t.distanceMiles === "number" ? `${t.distanceMiles.toFixed(1)} mi away` : undefined}
                pending={assign.isPending}
                onAssign={() => doAssign(t.id)}
                primary
              />
            ))
          )}
        </div>

        {/* All technicians fallback */}
        <div className="space-y-2 border-t pt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">All technicians</div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Search technicians" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {filteredTechs.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">No technicians found.</p>
            ) : (
              filteredTechs.map((u: User) => (
                <TechRow
                  key={u.id}
                  name={`${u.firstName} ${u.lastName}`}
                  sub={u.email}
                  pending={assign.isPending}
                  onAssign={() => doAssign(u.id)}
                />
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TechRow({
  name,
  sub,
  pending,
  onAssign,
  primary,
}: {
  name: string;
  sub?: string;
  pending: boolean;
  onAssign: () => void;
  primary?: boolean;
}) {
  const parts = name.split(" ");
  return (
    <div className="flex items-center gap-2.5 rounded-lg border p-2">
      <span className="grid size-7 flex-none place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
        {initials(parts[0] ?? name, parts[1] ?? "")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        {sub ? <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">{primary ? <MapPin className="size-3" /> : null}{sub}</div> : null}
      </div>
      <Button size="sm" variant={primary ? "brand" : "outline"} className="gap-1" disabled={pending} onClick={onAssign}>
        <UserPlus className="size-3.5" /> Assign
      </Button>
    </div>
  );
}
