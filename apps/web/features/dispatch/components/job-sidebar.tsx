"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, MapPinOff, Pencil, UserPlus, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { jobTypeLabel } from "@/features/deals/lib";
import { AssignTechDialog } from "@/features/deals/components/assign-tech-dialog";
import { hasCoords } from "@/lib/geo/geo";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b py-2 last:border-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

/** Job details next to the map, so editing never costs the dispatcher their view. */
export function JobSidebar({
  deal,
  clientName,
  techName,
  canEdit,
  onEdit,
  onClose,
}: {
  deal: Deal;
  clientName: string;
  techName?: string;
  canEdit: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const [assigning, setAssigning] = useState(false);
  const address = `${deal.address.street}${deal.address.unit ? ` ${deal.address.unit}` : ""}, ${deal.address.city} ${deal.address.state} ${deal.address.zip}`;

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="text-sm font-semibold">#{deal.dealNumber}</span>
        <StageBadge stage={deal.stage} />
        <Button
          size="icon"
          variant="ghost"
          className="ml-auto size-7"
          onClick={onClose}
          aria-label="Close job details"
        >
          <X className="size-4" />
        </Button>
      </div>

      <dl className="px-4">
        <Row label="Client" value={clientName} />
        <Row label="Job" value={jobTypeLabel(deal.jobType)} />
        <Row
          label="Address"
          value={
            <span className="flex items-start gap-1.5">
              {hasCoords(deal.address) ? null : (
                <MapPinOff className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
              )}
              <span>{address}</span>
            </span>
          }
        />
        <Row label="Service area" value={deal.serviceArea} />
        <Row
          label="Scheduled"
          value={
            deal.scheduledDate
              ? `${deal.scheduledDate}${deal.scheduledTimeSlot ? ` · ${deal.scheduledTimeSlot}` : ""}`
              : "—"
          }
        />
        <Row
          label="Technician"
          value={
            <span className="flex items-center gap-2">
              {techName ?? <span className="text-red-600">Unassigned</span>}
              {canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 gap-1.5 px-2 text-xs"
                  onClick={() => setAssigning(true)}
                >
                  <UserPlus className="size-3.5" />
                  {techName ? "Reassign" : "Assign"}
                </Button>
              ) : null}
            </span>
          }
        />
        {deal.notes ? <Row label="Notes" value={deal.notes} /> : null}
      </dl>

      {assigning ? (
        <AssignTechDialog dealId={deal.id} open onOpenChange={setAssigning} />
      ) : null}

      <div className="mt-auto flex gap-2 border-t p-4">
        {canEdit ? (
          <Button size="sm" className="flex-1 gap-1.5" onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
        <Button asChild size="sm" variant="outline" className="flex-1 gap-1.5">
          <Link href={`/deals/${deal.id}`}>
            Open deal <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </aside>
  );
}
