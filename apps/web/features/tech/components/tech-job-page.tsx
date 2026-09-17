"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, MapPin, Navigation, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact } from "@/features/clients/hooks";
import { useAddNote, useDeal } from "@/features/deals/hooks";
import { dealClientName, isUrgent } from "@/features/deals/lib";
import { PriorityFlag, StageBadge } from "@/features/deals/components/deal-badges";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { useJobTypeName } from "@/features/job-types/lib";
import { useJobStatusName } from "@/features/job-statuses/lib";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { formatPhone } from "@/lib/phone";
import { TECHNICIAN_HOME } from "@/lib/nav/nav-config";
import { addressLine, formatSlot, navigationUrl } from "../lib";
import { TechActions } from "./tech-actions";
import { TechPhotoCapture } from "./tech-photo-capture";

/**
 * `/my-jobs/:id` — one job as the technician needs it on a phone: where to go
 * and who to call at the top, then the single column of actions the visit runs
 * through, then photos and a note. Everything the office needs (line items,
 * custom fields, the full history) stays on the office job page, a tap away.
 */
export function TechJobPage({ dealId }: { dealId: string }) {
  const { can } = usePermissions();
  const { data: deal, isLoading, isError } = useDeal(dealId);
  const { data: contact } = useContact(deal?.contactId ?? "");
  const jobTypeName = useJobTypeName();
  const subStatusName = useJobStatusName();
  const addNote = useAddNote(dealId);
  const [note, setNote] = useState("");

  if (!can("deals", "view")) return <NoAccess entity="jobs" />;

  if (isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !deal) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">Job not found</h2>
        <p className="text-sm text-muted-foreground">
          It may have been reassigned. Pull your list to refresh.
        </p>
        <Button asChild variant="outline" className="mt-2">
          <Link href={TECHNICIAN_HOME}>Back to my jobs</Link>
        </Button>
      </div>
    );
  }

  const client = dealClientName(deal, contact);
  const address = addressLine(deal.address);
  const nav = navigationUrl(deal.address);
  const phone = contact?.phones[0] ?? "";
  const masked = Boolean(contact?.phonesMasked);
  const showCall = Boolean(deal.contactId) && Boolean(phone || masked);

  const saveNote = () => {
    const text = note.trim();
    if (!text) return;
    addNote.mutate(text, { onSuccess: () => setNote("") });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 sm:px-6">
        <Link
          href={TECHNICIAN_HOME}
          className="inline-flex h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-5" /> My Jobs
        </Link>
        <span className="font-mono text-sm font-semibold">#{deal.dealNumber}</span>
        <StageBadge status={deal.superStatus} />
        {isUrgent(deal) ? <PriorityFlag /> : null}
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-24 pt-4 sm:px-6">
        {/* Where and who — the two things needed before anything else. */}
        <section className="rounded-xl border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            {formatSlot(deal.scheduledTimeSlot, deal.allDay)} · {jobTypeName(deal.jobTypeId)}
            {deal.subStatusId ? ` · ${subStatusName(deal.subStatusId)}` : ""}
          </p>
          <h1 className="mt-1 text-xl font-semibold leading-tight">{client}</h1>
          {address ? (
            <p className="mt-2 flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 flex-none text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 leading-snug">{address}</span>
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {nav ? (
              <a
                href={nav}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-medium hover:bg-muted"
                aria-label={`Navigate to ${address || "the job"}`}
              >
                <Navigation className="size-5" /> Navigate
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
                className="flex-1"
              />
            ) : null}
          </div>
          {phone && !masked ? (
            <p className="mt-2 text-xs text-muted-foreground">{formatPhone(phone)}</p>
          ) : null}
          {deal.notes ? (
            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{deal.notes}</p>
          ) : null}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">This visit</h2>
          <TechActions deal={deal} />
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">Photos</h2>
          <TechPhotoCapture dealId={deal.id} />
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <StickyNote className="size-4" aria-hidden /> Add a note
          </h2>
          <Textarea
            rows={3}
            value={note}
            placeholder="What happened on this visit…"
            aria-label="Note"
            onChange={(e) => setNote(e.target.value)}
          />
          <Button
            type="button"
            className="mt-2 h-12 w-full rounded-xl"
            variant="outline"
            disabled={!note.trim() || addNote.isPending}
            onClick={saveNote}
          >
            {addNote.isPending ? <Loader2 className="size-5 animate-spin" /> : null}
            Save note
          </Button>
        </section>

        <p className="px-1 text-center text-xs text-muted-foreground">
          Need line items or the full history?{" "}
          <Link href={`/deals/${deal.id}`} className="underline underline-offset-2">
            Open the full job
          </Link>
        </p>
      </div>
    </div>
  );
}
