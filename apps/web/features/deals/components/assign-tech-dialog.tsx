"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, MapPin, Package, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { initials } from "@/features/clients/lib";
import { useAssignTechs, useQualifiedTechs } from "../hooks";
import { useTechStock } from "../tech-stock";
import { useProductMap } from "@/features/inventory/warehouses/hooks";
import type { IneligibilityReason, QualifiedTech } from "../api";

const REASON_LABEL: Record<IneligibilityReason, string> = {
  // Not "not yet assignable": the row is here because the projection still
  // holds it, and the commonest cause is that the person is not a technician
  // — someone whose role changed, or who never had it. Reading that as "still
  // onboarding" is what let a dispatcher assign them.
  not_assignable: "Not a technician",
  missing_job_type: "Missing job type",
  outside_area: "Outside service area",
};

/**
 * Roster editor: toggle any number of technicians onto the deal, then Apply.
 * Each row can expand to show what that technician carries, so a dispatcher can
 * pick the crew that actually has the parts for the job.
 */
export function AssignTechDialog({
  dealId,
  assignedTechIds,
  open,
  onOpenChange,
}: {
  dealId: string;
  assignedTechIds: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qualified = useQualifiedTechs(dealId, open);
  const assign = useAssignTechs(dealId);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(assignedTechIds);

  // Re-seed whenever the dialog reopens against a changed roster.
  useEffect(() => {
    if (open) setSelected(assignedTechIds);
  }, [open, assignedTechIds]);

  const techs = qualified.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return techs;
    return techs.filter((t) =>
      `${t.firstName ?? ""} ${t.lastName ?? ""}`.toLowerCase().includes(s),
    );
  }, [techs, search]);

  const eligible = filtered.filter((t) => t.eligible);
  // Three groups, not two. "Other technicians" used to swallow anyone the
  // backend couldn't vouch for as a technician at all, which is how people who
  // aren't technicians came to be offered here as if they were.
  const others = filtered.filter(
    (t) => !t.eligible && !t.reasons.includes("not_assignable"),
  );
  const notTechs = filtered.filter((t) => t.reasons.includes("not_assignable"));

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const dirty =
    selected.length !== assignedTechIds.length ||
    selected.some((id) => !assignedTechIds.includes(id));

  const apply = () =>
    assign.mutate(selected, { onSuccess: () => onOpenChange(false) });

  const row = (t: QualifiedTech) => (
    <TechRow
      key={t.id}
      tech={t}
      checked={selected.includes(t.id)}
      onToggle={() => toggle(t.id)}
      open={open}
      // A dispatcher may override "wrong job type" or "wrong area" — those are
      // judgement calls about a technician. "Not a technician" is not, so the
      // row is only unlocked to take someone already on the job back off it.
      // Keyed to who is on the job, not to the tick: keyed to the tick, the box
      // disabled itself the instant it was cleared, so a mis-click could only
      // be undone by closing the dialog.
      locked={t.reasons.includes("not_assignable") && !assignedTechIds.includes(t.id)}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign technicians</DialogTitle>
          <DialogDescription>
            Pick everyone working this job. Technicians approved for its job type and area come
            first, ranked by proximity — you can still assign any technician.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search technicians" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
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
                  eligible.map(row)
                )}
              </div>

              {others.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Other technicians</div>
                  {others.map(row)}
                </div>
              ) : null}

              {notTechs.length > 0 ? (
                <div className="space-y-2 border-t pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Not technicians
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Listed here because dispatch still holds a record for them. They can&apos;t be
                    assigned — give them the technician role and approve a job type and service
                    area first.
                  </p>
                  {notTechs.map(row)}
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="items-center sm:items-center">
          <span className="mr-auto text-xs text-muted-foreground">
            {selected.length} selected
          </span>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" className="gap-1.5" disabled={!dirty || assign.isPending} onClick={apply}>
            {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TechRow({
  tech,
  checked,
  onToggle,
  open,
  locked = false,
}: {
  tech: QualifiedTech;
  checked: boolean;
  onToggle: () => void;
  open: boolean;
  locked?: boolean;
}) {
  const [showItems, setShowItems] = useState(false);
  const name = `${tech.firstName ?? ""} ${tech.lastName ?? ""}`.trim() || tech.id;
  const parts = name.split(" ");
  const distance =
    typeof tech.distanceMiles === "number" ? `${tech.distanceMiles.toFixed(1)} mi from home` : null;

  return (
    <div
      className={cn(
        "rounded-lg border",
        checked && "border-primary/40 bg-primary/5",
        locked && "opacity-70",
      )}
    >
      <label className={cn("flex items-center gap-2.5 p-2", locked ? "cursor-not-allowed" : "cursor-pointer")}>
        <Checkbox
          checked={checked}
          disabled={locked}
          aria-label={locked ? `${name} can't be assigned` : `Assign ${name}`}
          onCheckedChange={onToggle}
        />
        <span className="grid size-7 flex-none place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
          {initials(parts[0] ?? name, parts[1] ?? "")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name}</span>
          <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {tech.eligible && distance ? (
              <span className="flex items-center gap-1"><MapPin className="size-3" />{distance}</span>
            ) : null}
            {!tech.eligible
              ? tech.reasons.map((r) => (
                  <Badge key={r} variant="secondary" className="font-normal">{REASON_LABEL[r]}</Badge>
                ))
              : null}
          </span>
        </span>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); setShowItems((v) => !v); }}
          className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          aria-label="Show carried items"
        >
          <Package className="size-3.5" />
          <ChevronDown className={cn("size-3 transition-transform", showItems && "rotate-180")} />
        </button>
      </label>

      {showItems ? <TechItems techId={tech.id} enabled={open} /> : null}
    </div>
  );
}

/** What this technician currently carries, from their inventory container. */
function TechItems({ techId, enabled }: { techId: string; enabled: boolean }) {
  const stock = useTechStock(techId, enabled);
  const { data: productMap } = useProductMap(enabled);
  const rows = useMemo(() => [...(stock.data?.entries() ?? [])].filter(([, q]) => q > 0), [stock.data]);

  if (stock.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" /> Loading items…
      </div>
    );
  }
  if (stock.isError) {
    return <p className="border-t px-3 py-2 text-xs text-muted-foreground">Couldn&apos;t load this technician&apos;s items.</p>;
  }
  if (rows.length === 0) {
    return <p className="border-t px-3 py-2 text-xs text-muted-foreground">Carries no stock right now.</p>;
  }

  return (
    <ul className="max-h-32 space-y-0.5 overflow-y-auto border-t px-3 py-2 text-xs">
      {rows.map(([productId, qty]) => (
        <li key={productId} className="flex justify-between gap-2">
          <span className="truncate text-muted-foreground">
            {productMap?.get(productId)?.name ?? productId}
          </span>
          <span className="font-mono">{qty}</span>
        </li>
      ))}
    </ul>
  );
}
