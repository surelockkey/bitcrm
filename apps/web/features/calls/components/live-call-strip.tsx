"use client";

import { useEffect, useState } from "react";
import { Loader2, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSoftphoneStore } from "@/features/telephony/softphone-store";
import { useCallTimer } from "@/features/telephony/use-call-timer";
import { usePermissions } from "@/features/auth/use-permissions";
import { useActiveCall, useLinkCallToDeal } from "../hooks";
import { counterparty, formatEndpoint } from "../lib";

/**
 * How long an unconfirmed answer may still be presented as fact. The poll runs
 * every 5s, so this is two missed rounds — long enough to ride out one blip,
 * short enough that nobody watches a ghost call.
 */
const CONFIRMED_WITHIN_MS = 15_000;

/**
 * How long a leg may be "connecting" before it is not a call anybody is on.
 * The ring itself is ~25s, and the server keeps ring-phase records live for
 * ten minutes for the dispatch board's sake — which is the right answer for a
 * board showing everything and the wrong one for telling ONE person they are
 * mid-call.
 */
const CONNECTING_GRACE_MS = 90_000;

/**
 * A ticking clock, so the guards below re-evaluate on their own. Reading
 * `Date.now()` during render would be both impure and stuck: the strip would
 * keep asserting a call until something else happened to re-render it.
 */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Shown on a job while a call is actually happening: who's on the line, and a
 * single button to attach that call to this job. It only exists during a call,
 * because that's the only moment "this call" means anything.
 *
 * Asks the server which call this user is on, not this tab's softphone. The
 * audio lives in one tab; the work doesn't — opening a job in a second tab
 * mid-call is the normal way to use this, and the strip has to be there.
 *
 * Everything here is an assertion about RIGHT NOW, learned from a 5s poll, so
 * it is only made while that assertion still holds up — see the guards below.
 * Saying nothing is always safe; claiming a call that ended is not.
 */
export function LiveCallStrip({ dealId }: { dealId: string }) {
  const { can } = usePermissions();
  // Whether the audio is in this tab is simply whether this tab is on a call —
  // no cross-tab bookkeeping needed to know that.
  const audioHere = useSoftphoneStore((s) => s.callState) !== "idle";
  const { data: call, isError, dataUpdatedAt } = useActiveCall(
    can("deals", "edit"),
  );
  const link = useLinkCallToDeal();
  const timer = useCallTimer(call?.answeredAt);
  const now = useNow(1000);

  if (!call?.callSid || !can("deals", "edit")) return null;

  // React Query keeps the last successful value when a refetch fails, so a
  // dropped session or a restarted service would otherwise freeze this strip
  // on screen for a call that ended minutes ago.
  if (isError) return null;
  if (dataUpdatedAt !== undefined && now - dataUpdatedAt > CONFIRMED_WITHIN_MS) {
    return null;
  }

  // A leg still "connecting" long after the ring gave up is not a call: either
  // nobody answered, or the webhook that would have said so never arrived.
  const connecting = !call.answeredAt;
  if (connecting && now - new Date(call.startedAt).getTime() > CONNECTING_GRACE_MS) {
    return null;
  }

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
          {audioHere ? "" : " · audio is in another tab"}
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
