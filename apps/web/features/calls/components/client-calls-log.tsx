"use client";

import { useRouter } from "next/navigation";
import { Loader2, Mic, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallsForNumbers } from "../hooks";
import { callUsers, formatCallTime, formatDuration } from "../lib";
import { CallStatusBadge } from "./call-status-badge";

/**
 * A client's call history, for their detail page. Matches on every number
 * they own and on either side of the call, so calls we placed to them count
 * the same as calls they made to us.
 */
export function ClientCallsLog({ phones }: { phones: string[] }) {
  const router = useRouter();
  const { can } = usePermissions();
  const query = useCallsForNumbers(phones);

  if (!can("calls")) return null;

  const calls = query.data?.pages.flatMap((p) => p.data) ?? [];

  if (phones.length === 0) {
    return (
      <Empty>No phone number on this client yet — nothing to match calls against.</Empty>
    );
  }
  if (query.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (calls.length === 0) {
    return <Empty>No calls with this client yet.</Empty>;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y rounded-lg border">
        {calls.map((call) => (
          <li
            key={call.callSid}
            className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-accent"
            onClick={() => router.push(`/calls/${call.callSid}`)}
          >
            {call.direction === "inbound" ? (
              <PhoneIncoming className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <PhoneOutgoing className="size-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate">
                {call.direction === "inbound" ? "Called in" : "We called"}
                {callUsers(call) !== "—" ? ` · ${callUsers(call)}` : ""}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatCallTime(call.startedAt)}
              </div>
            </div>
            {call.recordingSid ? (
              <Mic className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <CallStatusBadge status={call.status} />
            <span className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {formatDuration(call.durationSeconds)}
            </span>
          </li>
        ))}
      </ul>
      {query.hasNextPage ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={query.isFetchingNextPage}
          onClick={() => query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            "Load more"
          )}
        </Button>
      ) : null}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center">
      <Phone className="size-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
