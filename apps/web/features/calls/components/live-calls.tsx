"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Headphones, Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useSoftphoneStore } from "@/features/telephony/softphone-store";
import { monitorCall } from "@/features/telephony/softphone-manager";
import { useCallTimer } from "@/features/telephony/use-call-timer";
import { useLiveCalls } from "../hooks";
import { requestMonitor } from "../api";
import { callParty, counterparty, formatEndpoint, isInternalCall, otherPartyNumber, type CallRecord } from "../lib";

/** "0:12" / "12:34" / "1:02:03" → Workiz's "00:00:12" (callspage_wz_04_headset_esc). */
export function workizClock(timer: string): string {
  const parts = timer.split(":").map((p) => p.padStart(2, "0"));
  while (parts.length < 3) parts.unshift("00");
  return parts.join(":");
}

/** The round avatar Workiz draws at a teammate's left: initials on white, a green dot when online. */
export function MonitorAvatar({ name, online = true }: { name?: string; online?: boolean }) {
  const initials = (name ?? "")
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="relative grid size-[42px] shrink-0 place-items-center rounded-full border border-input bg-background text-sm text-foreground">
      {initials || "?"}
      {online ? <span aria-hidden className="absolute right-0 bottom-0.5 size-2 rounded-full bg-wz-switch-on ring-2 ring-background" /> : null}
    </span>
  );
}

/**
 * One call in progress, as Workiz's Call monitoring lists it ("On a call",
 * callspage_wz_04_headset_esc): our person at the left — avatar, name — and
 * at the right, past a rule, who they are talking to and "Duration:
 * 00:00:27". Ours on top: the direction line, and Listen / Join for someone
 * allowed to monitor.
 */
function LiveCallRow({ call, canJoin }: { call: CallRecord; canJoin: boolean }) {
  const router = useRouter();
  const timer = useCallTimer(call.answeredAt);
  const softphoneOnline = useSoftphoneStore((s) => s.status === "online");
  const inCall = useSoftphoneStore((s) => s.callState !== "idle");
  const [pending, setPending] = useState<"listen" | "join" | null>(null);

  const counterpart = otherPartyNumber(call);
  // The party that isn't one of us — the side worth naming.
  const outside = counterparty(call);
  // Whoever of ours handled it.
  const fromParty = callParty(call, "from");
  const ours = fromParty.kind === "user" ? fromParty : callParty(call, "to");
  const agent = ours.kind === "user" ? ours.name : call.agentName;
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

  const monitorButton = (mode: "listen" | "join") => (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            disabled={!monitorReady || pending !== null}
            onClick={() => startMonitor(mode)}
          >
            {pending === mode ? (
              <Loader2 className="size-3 animate-spin" />
            ) : mode === "listen" ? (
              <Headphones className="size-3" />
            ) : (
              <PhoneCall className="size-3" />
            )}
            {mode === "listen" ? "Listen" : "Join"}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {monitorReady
          ? mode === "listen"
            ? "Listen silently — the parties won't hear you"
            : "Join the conversation — everyone hears you"
          : "Turn your softphone on (and finish any call) first"}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <div
      className="flex cursor-pointer items-stretch border-b border-wz-disabled-border px-4 py-3 hover:bg-black/5"
      onClick={() => router.push(`/calls/${call.callSid}`)}
      role="row"
    >
      <div className="flex w-[195px] shrink-0 items-center gap-3 pr-3">
        <MonitorAvatar name={agent} />
        <span className="min-w-0 truncate text-sm leading-4 text-foreground">{agent ?? "—"}</span>
      </div>
      <div className="min-w-0 flex-1 border-l border-wz-disabled-border pl-4">
        {/* Internal calls (both sides are our users) lead with the people
            talking; customer calls lead with whoever is calling — the client's
            name when the CRM knows them, their number when it doesn't. */}
        {isInternalCall(call) ? (
          <>
            <div className="truncate text-[13px] leading-4 text-wz-outline-label">
              {callParty(call, "from").name} → {callParty(call, "to").name}
            </div>
            <div className="mt-1 truncate text-[11px] leading-4 text-wz-caption">
              Internal · {formatEndpoint(call.from)} → {formatEndpoint(call.to)}
            </div>
          </>
        ) : (
          <>
            <div className="truncate text-[13px] leading-4 text-wz-outline-label">{outside.name ?? formatEndpoint(outside.number)}</div>
            <div className="mt-1 truncate text-[11px] leading-4 text-wz-caption">
              {call.direction === "inbound" ? "Incoming" : "Outgoing"}
              {/* Named clients keep their number on this line. */}
              {outside.name ? ` · ${formatEndpoint(outside.number)}` : ""}
              {ours?.name ? ` · ${ours.name}` : ""}
            </div>
          </>
        )}
        <div className="mt-1 text-[11px] leading-4 text-foreground">
          Duration: <span className="font-medium tabular-nums">{call.answeredAt ? workizClock(timer) : "—"}</span>
        </div>
        {canJoin ? (
          <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            {monitorButton("listen")}
            {monitorButton("join")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The calls in progress, live over SSE — Call monitoring's "On a call". */
export function LiveCalls() {
  const { can } = usePermissions();
  const { data: liveCalls } = useLiveCalls();
  const canJoin = can("calls", "join");

  if (!liveCalls || liveCalls.length === 0) return null;

  return (
    <div>
      {liveCalls.map((call) => (
        <LiveCallRow key={call.callSid} call={call} canJoin={canJoin} />
      ))}
    </div>
  );
}
