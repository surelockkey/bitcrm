"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Headphones, Loader2, PhoneCall, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useSoftphoneStore } from "@/features/telephony/softphone-store";
import { monitorCall } from "@/features/telephony/softphone-manager";
import { useCallTimer } from "@/features/telephony/use-call-timer";
import { useLiveCalls } from "../hooks";
import { requestMonitor } from "../api";
import {
  callParty,
  counterparty,
  formatEndpoint,
  isInternalCall,
  otherPartyNumber,
  type CallRecord,
} from "../lib";
import { CallStatusBadge } from "./call-status-badge";

function LiveCallRow({ call, canJoin }: { call: CallRecord; canJoin: boolean }) {
  const router = useRouter();
  const timer = useCallTimer(call.answeredAt);
  const softphoneOnline = useSoftphoneStore((s) => s.status === "online");
  const inCall = useSoftphoneStore((s) => s.callState !== "idle");
  const [pending, setPending] = useState<"listen" | "join" | null>(null);

  const counterpart = otherPartyNumber(call);
  // The party that isn't one of us — the side worth naming.
  const outside = counterparty(call);
  // Whoever of ours handled it, for the detail line.
  const fromParty = callParty(call, "from");
  const ours = fromParty.kind === "user" ? fromParty : callParty(call, "to");
  const monitorReady = canJoin && softphoneOnline && !inCall;

  const startMonitor = async (mode: "listen" | "join") => {
    setPending(mode);
    try {
      const { conferenceName } = await requestMonitor(call.callSid, mode);
      await monitorCall(conferenceName, mode, formatEndpoint(counterpart));
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 transition-colors hover:bg-emerald-500/10"
      onClick={() => router.push(`/calls/${call.callSid}`)}
      role="row"
    >
      {call.direction === "inbound" ? (
        <PhoneIncoming className="size-4 shrink-0 text-emerald-600" />
      ) : (
        <PhoneOutgoing className="size-4 shrink-0 text-emerald-600" />
      )}
      <div className="min-w-0 flex-1">
        {/* Internal calls (both sides are our users) lead with the people
            talking; customer calls lead with whoever is calling — the client's
            name when the CRM knows them, their number when it doesn't. */}
        {isInternalCall(call) ? (
          <>
            <div className="truncate text-sm font-medium">
              {callParty(call, "from").name} → {callParty(call, "to").name}
            </div>
            <div className="text-xs text-muted-foreground">
              Internal · {formatEndpoint(call.from)} → {formatEndpoint(call.to)}
            </div>
          </>
        ) : (
          <>
            <div className="truncate text-sm font-medium">
              {outside.name ?? formatEndpoint(outside.number)}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {call.direction === "inbound" ? "Incoming" : "Outgoing"}
              {/* Named clients keep their number on the second line. */}
              {outside.name ? ` · ${formatEndpoint(outside.number)}` : ""}
              {ours?.name ? ` · ${ours.name}` : ""}
            </div>
          </>
        )}
      </div>
      <CallStatusBadge status={call.status} />
      <span className="w-16 text-right font-mono text-sm tabular-nums">
        {call.answeredAt ? timer : "—"}
      </span>
      {canJoin ? (
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!monitorReady || pending !== null}
                  onClick={() => startMonitor("listen")}
                >
                  {pending === "listen" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Headphones className="size-3.5" />
                  )}
                  Listen
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {monitorReady
                ? "Listen silently — the parties won't hear you"
                : "Turn your softphone on (and finish any call) first"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={!monitorReady || pending !== null}
                  onClick={() => startMonitor("join")}
                >
                  {pending === "join" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <PhoneCall className="size-3.5" />
                  )}
                  Join
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {monitorReady
                ? "Join the conversation — everyone hears you"
                : "Turn your softphone on (and finish any call) first"}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

/** Live calls pinned above the history list, streaming via SSE. */
export function LiveCalls() {
  const { can } = usePermissions();
  const { data: liveCalls } = useLiveCalls();
  const canJoin = can("calls", "join");

  if (!liveCalls || liveCalls.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
        Live now ({liveCalls.length})
      </h3>
      <div className="space-y-2">
        {liveCalls.map((call) => (
          <LiveCallRow key={call.callSid} call={call} canJoin={canJoin} />
        ))}
      </div>
    </div>
  );
}
