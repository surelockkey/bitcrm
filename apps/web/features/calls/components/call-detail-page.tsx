"use client";

import Link from "next/link";
import { ChevronLeft, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallDetail } from "../hooks";
import { useCallStream } from "../use-call-stream";
import {
  callParty,
  callUsers,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  isLive,
  otherParty,
  PARTICIPANT_ROLE_LABEL,
  type CallRecord,
} from "../lib";
import { CallPartyCell } from "./call-party-cell";
import { CallStatusBadge } from "./call-status-badge";
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
  const query = useCallDetail(callId);
  const call: CallRecord | undefined = query.data;
  const canView = can("calls");
  // Keep a live call's detail fresh (status/timer/recording) via SSE.
  useCallStream(canView && !!call && isLive(call));

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view calls.
        </p>
      </div>
    );
  }

  if (query.isLoading || !call) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const counterpart = otherParty(call);

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <Link
          href="/calls"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Calls
        </Link>
        <div className="ml-2 flex items-center gap-3">
          {call.direction === "inbound" ? (
            <PhoneIncoming className="size-5 text-muted-foreground" />
          ) : (
            <PhoneOutgoing className="size-5 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              {counterpart ? formatEndpoint(counterpart) : "Call"}
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
          <Field label="User" value={callUsers(call)} />
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
        </dl>
      </section>

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
