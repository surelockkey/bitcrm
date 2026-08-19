"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { useRoles } from "@/features/users/hooks";
import { roleName } from "@/features/users/lib";
import { addCallParticipant, listTransferTargets } from "../api";

export type TransferIntent = "transfer" | "add";

/**
 * Who to hand a live call to, or pull onto it. Same list either way — the only
 * difference is whether the caller stays on afterwards.
 *
 * Teammates only: every target is one of our own people, reachable either on
 * their softphone or on the personal number from their profile. Somebody
 * offline is still listed, because their personal number is exactly the case
 * where being offline matters.
 */
export function TransferPanel({
  callSid,
  intent,
  onClose,
  onDone,
}: {
  callSid: string;
  intent: TransferIntent;
  onClose: () => void;
  /** Fired after a hand-over, so the dialer can wind itself down. */
  onDone?: (intent: TransferIntent) => void;
}) {
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const { data: roles } = useRoles();

  const { data: targets, isLoading } = useQuery({
    queryKey: queryKeys.telephony.transferTargets(),
    queryFn: () => listTransferTargets(),
    staleTime: 15_000,
  });

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return targets ?? [];
    return (targets ?? []).filter((t) =>
      `${t.name} ${t.phone ?? ""}`.toLowerCase().includes(q),
    );
  }, [targets, query]);

  const send = async (userId: string, channel: "softphone" | "personal") => {
    setPending(`${userId}:${channel}`);
    try {
      await addCallParticipant(callSid, {
        userId,
        channel,
        handOver: intent === "transfer",
      });
      toast.success(
        intent === "transfer"
          ? "Transferring — you can hang up once they answer"
          : "Ringing them onto the call",
      );
      onDone?.(intent);
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">
            {intent === "transfer" ? "Transfer to" : "Add to the call"}
          </div>
          <p className="text-xs text-muted-foreground">
            {intent === "transfer"
              ? "They take over; you can hang up once they answer."
              : "They join — nobody leaves."}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="size-7 p-0" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search teammates…"
          className="h-8 pl-8 text-sm"
          autoFocus
        />
      </div>

      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 py-1">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            {query ? "Nobody matches." : "No teammates available."}
          </p>
        ) : (
          <ul className="divide-y">
            {visible.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    <span
                      className={
                        t.softphoneOnline
                          ? "size-1.5 rounded-full bg-emerald-500"
                          : "size-1.5 rounded-full bg-muted-foreground/40"
                      }
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{t.name}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {t.roleId ? roleName(t.roleId, roles) : "Team"}
                    {t.phone ? ` · ${formatPhone(t.phone)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    // Dialling a softphone nobody is registered on just rings
                    // out while the customer waits.
                    disabled={!t.softphoneOnline || pending !== null}
                    onClick={() => send(t.id, "softphone")}
                  >
                    {pending === `${t.id}:softphone` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "Softphone"
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={!t.phone || pending !== null}
                    title={
                      t.phone
                        ? `Call ${formatPhone(t.phone)}`
                        : "No personal number on their profile"
                    }
                    onClick={() => send(t.id, "personal")}
                  >
                    {pending === `${t.id}:personal` ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "Personal"
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
