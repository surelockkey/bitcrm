"use client";

import { useRouter } from "next/navigation";
import { Loader2, Mic, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallsForParty } from "../hooks";
import { callParty, formatCallTime, formatDuration } from "../lib";
import { CallStatusBadge } from "./call-status-badge";

/**
 * A client's call history, for their detail page. Served by the party index,
 * which covers every call whose association has been frozen — a call is
 * frozen once it has ended and been read, so anything older than the feature
 * appears after its first appearance in the main log.
 */
export function ClientCallsLog({
  contactId,
  kind = "contact",
}: {
  contactId: string;
  kind?: "contact" | "company";
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const query = useCallsForParty(kind, contactId);

  if (!can("calls")) return null;

  const calls = query.data?.pages.flatMap((p) => p.data) ?? [];

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
                {handledBy(call) ? ` · ${handledBy(call)}` : ""}
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

/** Which of our people was on the call, for the one-line summary. */
function handledBy(call: Parameters<typeof callParty>[0]): string | undefined {
  const from = callParty(call, "from");
  const ours = from.kind === "user" ? from : callParty(call, "to");
  return ours.kind === "user" ? ours.name : undefined;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed p-6 text-center">
      <Phone className="size-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{children}</p>
    </div>
  );
}
