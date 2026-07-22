"use client";

import { useState } from "react";
import Link from "next/link";
import { Briefcase, Building2, DollarSign, Loader2, User, UserPlus, Wrench, X } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCompanyMap } from "@/features/clients/hooks";
import { contactName, formatPhone, initials, primaryPhone, clientTypeLabel } from "@/features/clients/lib";
import { useContactMap, useDealProducts, useUnassignTech, useUserMap } from "../hooks";
import { dealTotal, formatMoney, formatSchedule } from "../lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { useJobSourceName } from "@/features/job-sources/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { AssignTechDialog } from "./assign-tech-dialog";

export function DealSummary({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const jobTypeName = useJobTypeName();
  const jobSourceName = useJobSourceName();
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
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Job */}
      <Card icon={<Briefcase className="size-3.5" />} title="Job">
        <dl className="text-sm">
          <Row label="Type" value={jobTypeName(deal.jobTypeId)} />
          <Row
            label="Address"
            value={`${deal.address.street}${deal.address.unit ? ` ${deal.address.unit}` : ""}, ${deal.address.city} ${deal.address.state} ${deal.address.zip}`}
          />
          <Row label="Service area" value={deal.serviceArea} />
          <Row label="Scheduled" value={formatSchedule(deal.scheduledDate, deal.scheduledTimeSlot)} />
          {deal.sourceId ? <Row label="Source" value={jobSourceName(deal.sourceId)} /> : null}
          {deal.tagIds.length ? <Row label="Tags" value={<JobTagChips ids={deal.tagIds} />} /> : null}
        </dl>
      </Card>

      {/* Client */}
      <Card icon={<User className="size-3.5" />} title="Client">
        {contact ? (
          <div className="space-y-1">
            <Link href={`/contacts/${contact.id}`} className="text-sm font-medium hover:underline">
              {contactName(contact)}
            </Link>
            {company ? (
              <Link href={`/companies/${company.id}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline">
                <Building2 className="size-3" />
                {company.title} · {clientTypeLabel(company.clientType)}
              </Link>
            ) : (
              <div className="text-xs text-muted-foreground">{clientTypeLabel(deal.clientType)}</div>
            )}
            {primaryPhone(contact) ? <div className="font-mono text-xs">{formatPhone(primaryPhone(contact)!)}</div> : null}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Contact {deal.contactId}</div>
        )}
      </Card>

      {/* Technician */}
      <Card icon={<Wrench className="size-3.5" />} title="Technician">
        {tech ? (
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-muted text-[11px] font-bold text-muted-foreground">
              {initials(tech.firstName, tech.lastName)}
            </span>
            <div className="flex-1 text-sm font-medium">{tech.firstName} {tech.lastName}</div>
            {canEdit ? (
              <button
                type="button"
                onClick={() => unassign.mutate()}
                disabled={unassign.isPending}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Unassign technician"
              >
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
      </Card>

      {/* Financials */}
      <Card icon={<DollarSign className="size-3.5" />} title="Financials">
        <dl className="text-sm">
          <Row label="Line items" value={<Money value={total} />} tight />
          {typeof deal.estimatedTotal === "number" ? <Row label="Estimated" value={<Money value={deal.estimatedTotal} />} tight /> : null}
          {typeof deal.actualTotal === "number" ? <Row label="Paid" value={<Money value={deal.actualTotal} className="text-emerald-600" />} tight /> : null}
          <Row
            label="Payment"
            value={<span className={cn(deal.paymentStatus === "paid" ? "text-emerald-600" : "text-muted-foreground")}>{deal.paymentStatus ?? "unpaid"}</span>}
            tight
          />
        </dl>
      </Card>

      <AssignTechDialog dealId={deal.id} open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  );
}

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </div>
      {children}
    </section>
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

function Money({ value, className }: { value: number; className?: string }) {
  return <span className={cn("font-mono tabular-nums", className)}>{formatMoney(value)}</span>;
}
