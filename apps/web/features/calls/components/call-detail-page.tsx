"use client";

import { PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useCallPageData } from "../calls-page-data";
import { useCallStream } from "../use-call-stream";
import {
  callParty,
  counterparty,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  isLive,
  PARTICIPANT_ROLE_LABEL,
  type CallRecord,
} from "../lib";
import { CallAssociations } from "./call-associations";
import { CallFlowPath } from "./call-flow-path";
import { CallPartyCell } from "./call-party-cell";
import { CallStatusBadge } from "./call-status-badge";
import { CallTagsCell } from "./call-tags-cell";
import { RecordingPlayer } from "./recording-player";
import { LiveCalls } from "./live-calls";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm font-medium">{value ?? "—"}</dd>
    </div>
  );
}

export function CallDetailPage({ callId }: { callId: string }) {
  const { can } = usePermissions();
  const denied = useDenied();
  // The call and everything its blocks print, asked for at once.
  const { detail: query, allIn } = useCallPageData(callId);
  const call: CallRecord | undefined = query.data;
  const canView = can("calls");
  // Keep a live call's detail fresh (status/timer/recording) via SSE.
  useCallStream(canView && !!call && isLive(call));
  // One skeleton, then the page whole — and it stays: a relink or a live
  // update redraws a block, never the page.
  const shown = usePageReady(allIn);

  if (denied("calls")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view calls.
        </p>
      </div>
    );
  }

  if (!shown || !call) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const counterpart = counterparty(call);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          {call.direction === "inbound" ? (
            <PhoneIncoming className="size-5 text-muted-foreground" />
          ) : (
            <PhoneOutgoing className="size-5 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {counterpart.name ?? formatEndpoint(counterpart.number)}
            </h1>
            <p className="text-sm text-muted-foreground">
              {call.direction === "inbound" ? "Incoming call" : "Outgoing call"} ·{" "}
              {formatCallTime(call.startedAt)}
            </p>
          </div>
        </div>
        <div className="ml-auto">
          <CallStatusBadge status={call.status} />
        </div>
      </div>

      {isLive(call) ? <LiveCalls /> : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Details</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 rounded-lg border p-4 sm:grid-cols-3">
          <Field label="From" value={<CallPartyCell party={callParty(call, "from")} />} />
          <Field label="To" value={<CallPartyCell party={callParty(call, "to")} />} />
          <Field label="Started" value={formatCallTime(call.startedAt)} />
          <Field label="Answered" value={formatCallTime(call.answeredAt)} />
          <Field label="Ended" value={formatCallTime(call.endedAt)} />
          <Field
            label="Talk time"
            value={formatDuration(call.durationSeconds)}
          />
          <Field label="Call SID" value={<code className="text-xs">{call.callSid}</code>} />
          <Field
            label="Recording"
            value={
              call.recordingSid
                ? formatDuration(call.recordingDurationSeconds)
                : "None"
            }
          />
          {/* Same picker as the log and the side preview — whoever opened the
              full call can still mark it spam without going back. */}
          <Field label="Tags" value={<CallTagsCell call={call} />} />
        </dl>
      </section>

      <CallAssociations call={call} />

      <CallFlowPath flowName={call.flowName} path={call.flowPath} />

      {call.participants && call.participants.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">People on this call</h2>
          <ul className="divide-y rounded-lg border">
            {call.participants.map((p, i) => (
              <li
                key={`${p.userId}-${p.role}-${i}`}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
              >
                <span className="font-medium">
                  {p.name ?? `${p.userId.slice(0, 8)}…`}
                </span>
                <span className="text-muted-foreground">
                  {PARTICIPANT_ROLE_LABEL[p.role]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatCallTime(p.at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Recording</h2>
        <div className="rounded-lg border p-4">
          <RecordingPlayer
            callSid={call.callSid}
            hasRecording={!!call.recordingSid}
          />
        </div>
      </section>
    </div>
  );
}
