"use client";

import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import type { Contact, Deal, User } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { contactName, initials } from "@/features/clients/lib";
import { formatMoney, isUrgent } from "../lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { TechChips } from "./assigned-techs";
import { PriorityFlag } from "./deal-badges";

export function DealCard({
  deal,
  contactMap,
  userMap,
}: {
  deal: Deal;
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
}) {
  const router = useRouter();
  const jobTypeName = useJobTypeName();
  const contact = contactMap.get(deal.contactId);
  const client = contact ? contactName(contact) : "—";

  return (
    <button
      type="button"
      onClick={() => router.push(`/deals/${deal.id}`)}
      className="flex w-full flex-col gap-1.5 rounded-lg border bg-card p-2.5 text-left shadow-sm transition-colors hover:border-foreground/20 hover:bg-accent/40"
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] text-muted-foreground">#{deal.dealNumber}</span>
        {isUrgent(deal) ? <PriorityFlag /> : null}
      </div>
      <div className="truncate text-sm font-semibold">{client}</div>
      <div className="flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
        <MapPin className="size-3 flex-none" />
        {deal.serviceArea} · {jobTypeName(deal.jobTypeId)}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <TechChips techIds={deal.assignedTechIds} userMap={userMap} size="xs" emptyText={null} />
        <JobTagChips ids={deal.tagIds} max={2} />
        {typeof deal.estimatedTotal === "number" ? (
          <span className={cn("ml-auto font-mono text-[11px]", deal.actualTotal ? "text-emerald-600" : "text-muted-foreground")}>
            {formatMoney(deal.actualTotal ?? deal.estimatedTotal)}
          </span>
        ) : null}
      </div>
    </button>
  );
}
