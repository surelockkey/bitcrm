"use client";

import Link from "next/link";
import {
  ExternalLink,
  Loader2,
  PhoneIncoming,
  PhoneOutgoing,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useJobSourceName } from "@/features/job-sources/lib";
import { useCallDetail } from "../hooks";
import {
  callParty,
  counterparty,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  type CallRecord,
} from "../lib";
import { CallAssociations } from "./call-associations";
import { CallPartyCell } from "./call-party-cell";
import { CallStatusBadge } from "./call-status-badge";
import { RecordingPlayer } from "./recording-player";

/**
 * Side preview of a call, opened from the call log — the dispatcher hears
 * the recording and fixes the client/job links without leaving the list
 * (Workiz-style). The full page stays a click away.
 */
export function CallQuickView({
  callSid,
  open,
  onOpenChange,
}: {
  callSid: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-[440px] max-w-[94vw] flex-col gap-0 p-0 sm:max-w-[440px]"
      >
        {open && callSid ? (
          <QuickViewBody callSid={callSid} />
        ) : (
          <SheetTitle className="sr-only">Call</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * Prewire the New Job page with everything the call already knows: the call
 * itself (it gets linked to the created job), the client — or at least their
 * number — and the job source the tracked number attributed the call to.
 */
function createJobHref(call: CallRecord): string {
  const counterpart = counterparty(call);
  const params = new URLSearchParams({ callSid: call.callSid });
  if (counterpart.kind === "contact" && counterpart.id) {
    params.set("contactId", counterpart.id);
  } else if (counterpart.number) {
    params.set("phone", counterpart.number);
  }
  if (call.sourceId) params.set("sourceId", call.sourceId);
  return `/deals/new?${params.toString()}`;
}

function QuickViewBody({ callSid }: { callSid: string }) {
  const { data: call, isLoading } = useCallDetail(callSid);
  const sourceName = useJobSourceName();

  if (isLoading || !call) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const counterpart = counterparty(call);

  return (
    <>
      {/* pr-12 leaves room for the Sheet's built-in close (X) button. */}
      <SheetHeader className="space-y-0 border-b py-3.5 pl-5 pr-12">
        <div className="flex items-center gap-2">
          {call.direction === "inbound" ? (
            <PhoneIncoming className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <PhoneOutgoing className="size-4 shrink-0 text-muted-foreground" />
          )}
          <SheetTitle className="truncate text-base">
            {counterpart.name ?? formatEndpoint(counterpart.number)}
          </SheetTitle>
        </div>
        <p className="text-sm text-muted-foreground">
          {call.direction === "inbound" ? "Incoming call" : "Outgoing call"} ·{" "}
          {formatCallTime(call.startedAt)}
        </p>
      </SheetHeader>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        <Row label="Status">
          <CallStatusBadge status={call.status} />
        </Row>

        <Row label="Recording">
          <RecordingPlayer
            callSid={call.callSid}
            hasRecording={!!call.recordingSid}
          />
        </Row>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Row label="From">
            <CallPartyCell party={callParty(call, "from")} />
          </Row>
          <Row label="To">
            <CallPartyCell party={callParty(call, "to")} />
          </Row>
          <Row label="Started">
            <span className="text-sm">{formatCallTime(call.startedAt)}</span>
          </Row>
          <Row label="Talk time">
            <span className="text-sm tabular-nums">
              {formatDuration(call.durationSeconds)}
            </span>
          </Row>
          {call.sourceId ? (
            <Row label="Source">
              <span className="text-sm">{sourceName(call.sourceId)}</span>
            </Row>
          ) : null}
        </div>

        <CallAssociations call={call} />
      </div>

      <div className="space-y-2 border-t p-4">
        {/* Creating the job carries the call's attribution with it: client,
            number and job source arrive on the form prefilled, and the call
            is linked to the job on create. Hidden once a job is linked. */}
        {!call.dealId ? (
          <Button asChild variant="brand" className="w-full gap-1.5">
            <Link href={createJobHref(call)}>
              <Plus className="size-4" /> Create job
            </Link>
          </Button>
        ) : null}
        <Button
          asChild
          variant={call.dealId ? "brand" : "outline"}
          className="w-full gap-1.5"
        >
          <Link
            href={`/calls/${call.callSid}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open full call <ExternalLink className="size-4" />
          </Link>
        </Button>
      </div>
    </>
  );
}
