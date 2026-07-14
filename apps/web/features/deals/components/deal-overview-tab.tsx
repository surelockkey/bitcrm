"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Loader2, UserPlus, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanyMap } from "@/features/clients/hooks";
import { contactName, formatPhone, initials, primaryPhone } from "@/features/clients/lib";
import { clientTypeLabel } from "@/features/clients/lib";
import { useContactMap, useDealProducts, useUnassignTech, useUserMap } from "../hooks";
import { dealTotal, formatMoney, formatSchedule, jobTypeLabel } from "../lib";
import { AssignTechDialog } from "./assign-tech-dialog";

export function DealOverviewTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const { map: contactMap } = useContactMap();
  const { map: companyMap } = useCompanyMap();
  const { map: userMap } = useUserMap();
  const { data: products } = useDealProducts(deal.id);
  const unassign = useUnassignTech(deal.id);
  const [assignOpen, setAssignOpen] = useState(false);

  const contact = contactMap.get(deal.contactId);
  const company = deal.companyId ? companyMap.get(deal.companyId) : undefined;
  const tech = deal.assignedTechId ? userMap.get(deal.assignedTechId) : undefined;
  const total = dealTotal(products ?? []);

  return (
    <div className="grid gap-0 md:grid-cols-[1fr_300px]">
      <div className="space-y-5 md:pr-6">
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job</div>
          <dl className="text-sm">
            <Row label="Type" value={jobTypeLabel(deal.jobType)} />
            <Row label="Address" value={`${deal.address.street}${deal.address.unit ? ` ${deal.address.unit}` : ""}, ${deal.address.city} ${deal.address.state} ${deal.address.zip}`} />
            <Row label="Service area" value={deal.serviceArea} />
            <Row label="Scheduled" value={formatSchedule(deal.scheduledDate, deal.scheduledTimeSlot)} />
            {deal.source ? <Row label="Source" value={deal.source} /> : null}
            {deal.tags.length ? <Row label="Tags" value={deal.tags.join(", ")} /> : null}
          </dl>
        </div>
        {deal.notes ? <Section label="Notes">{deal.notes}</Section> : null}
        {deal.internalNotes ? <Section label="Internal notes" tone="warn">{deal.internalNotes}</Section> : null}
      </div>

      <div className="mt-5 space-y-3 border-t pt-5 md:mt-0 md:border-l md:border-t-0 md:pl-6 md:pt-0">
        {/* Client */}
        <div className="rounded-lg border p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</div>
          {contact ? (
            <>
              <Link href={`/contacts/${contact.id}`} className="text-sm font-medium hover:underline">{contactName(contact)}</Link>
              {company ? (
                <Link href={`/companies/${company.id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"><Building2 className="size-3" />{company.title} · {clientTypeLabel(company.clientType)}</Link>
              ) : (
                <div className="text-xs text-muted-foreground">{clientTypeLabel(deal.clientType)}</div>
              )}
              {primaryPhone(contact) ? <div className="mt-1 font-mono text-xs">{formatPhone(primaryPhone(contact)!)}</div> : null}
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Contact {deal.contactId}</div>
          )}
        </div>

        {/* Technician */}
        <div className="rounded-lg border p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Technician</div>
          {tech ? (
            <div className="flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">{initials(tech.firstName, tech.lastName)}</span>
              <div className="flex-1 text-sm font-medium">{tech.firstName} {tech.lastName}</div>
              {canEdit ? (
                <button type="button" onClick={() => unassign.mutate()} disabled={unassign.isPending} className="text-muted-foreground hover:text-destructive" aria-label="Unassign">
                  {unassign.isPending ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">Unassigned</div>
              {canEdit ? (
                <Button variant="brand" size="sm" className="mt-2 w-full gap-1.5" onClick={() => setAssignOpen(true)}>
                  <UserPlus className="size-3.5" /> Assign technician
                </Button>
              ) : null}
            </>
          )}
        </div>

        {/* Financials */}
        <div className="rounded-lg border p-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Financials</div>
          <dl className="text-sm">
            <Row label="Line items" value={<span className="font-mono tabular-nums">{formatMoney(total)}</span>} tight />
            {typeof deal.estimatedTotal === "number" ? <Row label="Estimated" value={<span className="font-mono tabular-nums">{formatMoney(deal.estimatedTotal)}</span>} tight /> : null}
            {typeof deal.actualTotal === "number" ? <Row label="Paid" value={<span className="font-mono tabular-nums text-emerald-600">{formatMoney(deal.actualTotal)}</span>} tight /> : null}
            <Row label="Payment" value={<span className={cn(deal.paymentStatus === "paid" ? "text-emerald-600" : "text-muted-foreground")}>{deal.paymentStatus ?? "unpaid"}</span>} tight />
          </dl>
        </div>
      </div>

      <AssignTechDialog dealId={deal.id} open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  );
}

function Row({ label, value, tight }: { label: string; value: React.ReactNode; tight?: boolean }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b last:border-0", tight ? "py-1" : "py-2")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Section({ label, tone, children }: { label: string; tone?: "warn"; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn("mb-1 text-xs font-semibold uppercase tracking-wide", tone === "warn" ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground")}>{label}</div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
