"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck, ChevronRight, Clock, MapPin, MapPinCheck, Navigation } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { useContact } from "@/features/clients/hooks";
import { formatPhone } from "@/lib/phone";
import { dealClientName, isUrgent } from "@/features/deals/lib";
import { PriorityFlag, StageBadge } from "@/features/deals/components/deal-badges";
import { useJobTypeName } from "@/features/job-types/lib";
import { useJobStatusName } from "@/features/job-statuses/lib";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { clockInTz } from "@/lib/timezone";
import { addressLine, formatSlot, navigationUrl } from "../lib";

/** Where a card opens — the technician's own job page. */
export const techJobHref = (dealId: string): string => `/my-jobs/${dealId}`;

/**
 * One job on the technician's day list, sized for a thumb: the time first,
 * the client and where to go, a tap-to-navigate link and a call button —
 * with the number itself masked when the viewer may not see it — and the
 * status. Tapping the card opens the job; the action row swallows its own
 * taps so a Navigate never also opens the job.
 */
export function TechJobCard({ deal, position }: { deal: Deal; position?: number }) {
  const router = useRouter();
  const { data: contact } = useContact(deal.contactId);
  const jobTypeName = useJobTypeName();
  const subStatusName = useJobStatusName();
  const client = dealClientName(deal, contact);
  const address = addressLine(deal.address);
  const nav = navigationUrl(deal.address);
  const phone = contact?.phones[0] ?? "";
  const masked = Boolean(contact?.phonesMasked);
  const showCall = Boolean(deal.contactId) && Boolean(phone || masked);
  const href = techJobHref(deal.id);

  return (
    <article
      data-testid="tech-job-card"
      onClick={() => router.push(href)}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm transition-colors active:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-base font-semibold">
            {position ? (
              <span
                className="grid size-6 flex-none place-items-center rounded-full bg-brand/10 text-xs font-bold text-brand"
                aria-label={`Stop ${position}`}
              >
                {position}
              </span>
            ) : null}
            <Clock className="size-4 flex-none text-muted-foreground" aria-hidden />
            <span className="truncate">{formatSlot(deal.scheduledTimeSlot, deal.allDay)}</span>
          </div>
          <div className="mt-1 truncate text-lg font-semibold leading-tight">{client}</div>
          <div className="mt-0.5 truncate text-sm text-muted-foreground">
            #{deal.dealNumber} · {jobTypeName(deal.jobTypeId)}
          </div>
        </div>
        <div className="flex flex-none flex-col items-end gap-1">
          <StageBadge status={deal.superStatus} />
          {deal.subStatusId ? (
            <span className="max-w-[9rem] truncate text-[11px] text-muted-foreground">
              {subStatusName(deal.subStatusId)}
            </span>
          ) : null}
          {isUrgent(deal) ? <PriorityFlag /> : null}
        </div>
      </div>

      {address ? (
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="mt-0.5 size-4 flex-none text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 leading-snug">{address}</span>
        </div>
      ) : null}

      {/* Where the job stands with the technician, for the glance. */}
      {deal.techConfirmedAt || deal.arrivedAt ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {deal.techConfirmedAt ? (
            <span className="inline-flex items-center gap-1">
              <CheckCheck className="size-3.5" aria-hidden /> Confirmed {clockInTz(deal.techConfirmedAt)}
            </span>
          ) : null}
          {deal.arrivedAt ? (
            <span className="inline-flex items-center gap-1">
              <MapPinCheck className="size-3.5" aria-hidden /> Arrived {clockInTz(deal.arrivedAt)}
            </span>
          ) : null}
        </div>
      ) : null}

      {/* The action row keeps its taps: a Navigate or a Call must not also open the job. */}
      <div
        className="flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {nav ? (
          <a
            href={nav}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-lg border bg-background px-4 text-sm font-medium hover:bg-muted"
            aria-label={`Navigate to ${address || "the job"}`}
          >
            <Navigation className="size-4" /> Navigate
          </a>
        ) : null}
        {showCall ? (
          <CallClientButton
            to={masked ? "" : phone}
            partyId={deal.contactId}
            dealId={deal.id}
            contactId={deal.contactId}
            phoneIndex={0}
            variant="prominent"
          />
        ) : null}
        {phone && !masked ? (
          <span className="text-sm text-muted-foreground">{formatPhone(phone)}</span>
        ) : null}
        <Link
          href={href}
          className="ml-auto inline-flex h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
          aria-label={`Open job #${deal.dealNumber}`}
        >
          Open <ChevronRight className="size-5" />
        </Link>
      </div>
    </article>
  );
}
