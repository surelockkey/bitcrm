"use client";

import Link from "next/link";
import {
  ChevronDown,
  ExternalLink,
  Loader2,
  Mail,
  MapPin,
  Phone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { usePermissions } from "@/features/auth/use-permissions";
import { contactName, formatAddress, formatPhone, primaryEmail, primaryPhone } from "@/features/clients/lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { JobStatusSelect } from "@/features/job-statuses/components/job-status-select";
import { useDeal, useDealProducts, useContactMap, useUpdateDeal, useMoveStatus, useUserMap } from "../hooks";
import { dealTotal, formatMoney, formatSchedule, isUrgent } from "../lib";
import { PriorityFlag } from "./deal-badges";
import { TechChips } from "./assigned-techs";

export function DealQuickView({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[440px] max-w-[94vw] flex-col gap-0 p-0 sm:max-w-[440px]">
        {open && dealId ? <QuickViewBody dealId={dealId} /> : <SheetTitle className="sr-only">Job</SheetTitle>}
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function QuickViewBody({ dealId }: { dealId: string }) {
  const { can } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const { map: contactMap } = useContactMap();
  const { map: userMap } = useUserMap();
  const { data: products } = useDealProducts(dealId);
  const update = useUpdateDeal(dealId);
  const moveStatus = useMoveStatus(dealId);
  const jobTypeName = useJobTypeName();

  if (isLoading || !deal) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const contact = contactMap.get(deal.contactId);
  const phone = contact ? primaryPhone(contact) : undefined;
  const email = contact ? primaryEmail(contact) : undefined;
  const productsTotal = products ? dealTotal(products) : undefined;
  const total = deal.actualTotal ?? deal.estimatedTotal ?? productsTotal;
  const canEdit = can("deals", "edit");

  return (
    <>
      {/* pr-12 leaves room for the Sheet's built-in close (X) button. */}
      <SheetHeader className="space-y-0 border-b py-3.5 pl-5 pr-12">
        <div className="font-mono text-xs text-muted-foreground">Job #{deal.dealNumber}</div>
        <SheetTitle className="truncate text-base">
          {contact ? contactName(contact) : "Job"}
        </SheetTitle>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Row label="Status">
          <div className="flex flex-wrap items-center gap-2">
            {isUrgent(deal) ? <PriorityFlag /> : null}
            <JobStatusSelect
              value={{ superStatus: deal.superStatus, subStatusId: deal.subStatusId }}
              onChange={(v) =>
                moveStatus.mutate(v, { onSuccess: () => toast.success("Status updated") })
              }
              disabled={!canEdit}
            />
          </div>
        </Row>

        <Row label="Client">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              {contact ? (
                <Link href={`/contacts/${contact.id}`} className="font-medium hover:underline">
                  {contactName(contact)}
                </Link>
              ) : (
                <div className="font-medium">—</div>
              )}
              {phone ? (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {formatPhone(phone)}
                  <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">Primary</span>
                </div>
              ) : null}
              {deal.address ? (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="size-3.5 flex-none" /> {formatAddress(deal.address)}
                </div>
              ) : null}
            </div>
            <div className="flex gap-1.5">
              {phone ? (
                <Button asChild variant="outline" size="icon" className="size-8" title={formatPhone(phone)}>
                  <a href={`tel:${phone}`}><Phone className="size-3.5" /></a>
                </Button>
              ) : null}
              {email ? (
                <Button asChild variant="outline" size="icon" className="size-8" title={email}>
                  <a href={`mailto:${email}`}><Mail className="size-3.5" /></a>
                </Button>
              ) : null}
            </div>
          </div>
        </Row>

        <Row label="Job type">
          <div>{jobTypeName(deal.jobTypeId)}</div>
        </Row>

        <Row label="Tags">
          {canEdit ? (
            <JobTagCombobox value={deal.tagIds ?? []} onChange={(ids) => update.mutate({ tagIds: ids })} />
          ) : deal.tagIds?.length ? (
            <JobTagChips ids={deal.tagIds} />
          ) : (
            <span className="text-sm text-muted-foreground">—</span>
          )}
        </Row>

        <Row label="Schedule">
          <div className="text-sm">{formatSchedule(deal.scheduledDate, deal.scheduledTimeSlot)}</div>
        </Row>

        <Row label="Team">
          <TechChips techIds={deal.assignedTechIds} userMap={userMap} emptyText="Unassigned" />
        </Row>

        {deal.notes ? (
          <Row label="Description">
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{deal.notes}</p>
          </Row>
        ) : null}

        <details className="rounded-lg border">
          <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
            <span>Finance</span>
            <span className="flex items-center gap-2 text-muted-foreground">
              {typeof total === "number" ? formatMoney(total) : "—"} <ChevronDown className="size-4" />
            </span>
          </summary>
          <div className="space-y-1.5 border-t px-3 py-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Estimated</span><span className="tabular-nums">{typeof deal.estimatedTotal === "number" ? formatMoney(deal.estimatedTotal) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Actual</span><span className="tabular-nums">{typeof deal.actualTotal === "number" ? formatMoney(deal.actualTotal) : "—"}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Payment</span><span>{deal.paymentStatus ?? "—"}</span></div>
          </div>
        </details>
      </div>

      <div className="border-t p-4">
        <Button asChild variant="brand" className="w-full gap-1.5">
          <Link href={`/deals/${deal.id}`} target="_blank" rel="noopener noreferrer">
            Open full job <ExternalLink className="size-4" />
          </Link>
        </Button>
      </div>
    </>
  );
}
