"use client";

import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoftphoneStore } from "@/features/telephony/softphone-store";
import { useCallTimer } from "@/features/telephony/use-call-timer";
import { usePermissions } from "@/features/auth/use-permissions";
import { useActiveCall, useLinkCallToDeal } from "../hooks";
import { counterparty, formatEndpoint } from "../lib";

/**
 * Shown on a job while a call is actually happening: who's on the line, and a
 * single button to attach that call to this job. It only exists during a call,
 * because that's the only moment "this call" means anything.
 */
export function LiveCallStrip({ dealId }: { dealId: string }) {
  const { can } = usePermissions();
  const callState = useSoftphoneStore((s) => s.callState);
  const onACall = callState === "active";
  const { data: call } = useActiveCall(onACall);
  const link = useLinkCallToDeal();
  const timer = useCallTimer(call?.answeredAt);

  if (!onACall || !call?.callSid || !can("deals", "edit")) return null;

  const alreadyHere = call.dealId === dealId;
  const client = counterparty(call);

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-emerald-500/30 bg-emerald-500/5 px-5 py-3">
      <PhoneCall className="size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          Call in progress — {client.name ?? formatEndpoint(client.number)}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {client.name ? `${formatEndpoint(client.number)} · ` : ""}
          {call.answeredAt ? timer : "connecting"}
        </div>
      </div>
      {alreadyHere ? (
        <span className="text-xs text-muted-foreground">
          Linked to this job
        </span>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={link.isPending}
          onClick={() => link.mutate({ sid: call.callSid, dealId })}
        >
          {link.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {call.dealId ? "Link to this job instead" : "Link this call"}
        </Button>
      )}
    </div>
  );
}
