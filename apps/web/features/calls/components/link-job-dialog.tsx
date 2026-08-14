"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeals, useContactMap } from "@/features/deals/hooks";
import { stageLabel } from "@/features/deals/lib";
import { formatAddress } from "@/features/clients/lib";
import { useLinkCallToDeal } from "../hooks";
import { counterparty, formatEndpoint, type CallRecord } from "../lib";

/**
 * Pick the job a call is about.
 *
 * Opens on this client's own jobs, newest first — the call already answered
 * "whose job?", so the list starts where the answer almost always is, with no
 * typing. Searching widens to every job in the workspace, for the calls that
 * turn out to be about somebody else's work.
 */
export function LinkJobDialog({
  call,
  onClose,
}: {
  /** null keeps the dialog closed. */
  call: CallRecord | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const link = useLinkCallToDeal();
  const { data: deals, isLoading } = useDeals();
  const { map: contacts } = useContactMap();

  const client = call ? counterparty(call) : null;
  const clientContactId = client?.kind === "contact" ? client.id : undefined;

  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  // Untyped, the list is this client's jobs alone. An unidentified caller has
  // no client to narrow by, so it falls back to the workspace's latest.
  const shown = searching
    ? (deals ?? []).filter((d) => {
        const contact = contacts.get(d.contactId);
        const name = contact ? `${contact.firstName} ${contact.lastName}` : "";
        return `${d.dealNumber ?? ""} ${name} ${formatAddress(d.address)}`
          .toLowerCase()
          .includes(q);
      })
    : clientContactId
      ? (deals ?? []).filter((d) => d.contactId === clientContactId)
      : (deals ?? []);

  const ranked = [...shown].sort((a, b) => {
    // Within a search, this client's jobs still come first — the rest of the
    // workspace is there to be reached, not to bury the likely answer.
    if (searching) {
      const aMine = a.contactId === clientContactId ? 1 : 0;
      const bMine = b.contactId === clientContactId ? 1 : 0;
      if (aMine !== bMine) return bMine - aMine;
    }
    return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
  });

  const choose = (dealId: string) => {
    if (!call) return;
    link.mutate(
      { sid: call.callSid, dealId },
      { onSuccess: onClose },
    );
  };

  const unlink = () => {
    if (!call) return;
    link.mutate({ sid: call.callSid, dealId: null }, { onSuccess: onClose });
  };

  return (
    <Dialog open={!!call} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link to job</DialogTitle>
          <DialogDescription>
            {call
              ? `${client?.name ?? formatEndpoint(client?.number)} · ${
                  call.direction === "inbound" ? "incoming" : "outgoing"
                } call`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all jobs by number, client or address…"
            className="h-9 pl-8"
            autoFocus
          />
        </div>

        <p className="-mb-1 text-xs text-muted-foreground">
          {searching
            ? "All jobs"
            : clientContactId
              ? `${client?.name ?? "This client"} · latest jobs first`
              : "Latest jobs"}
        </p>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : ranked.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {searching
                ? "No jobs match."
                : "No jobs for this client yet — search to find another, or create one."}
            </p>
          ) : (
            <ul className="divide-y">
              {ranked.slice(0, 40).map((deal) => {
                const contact = contacts.get(deal.contactId);
                const isClientMatch = searching && deal.contactId === clientContactId;
                return (
                  <li key={deal.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-accent"
                      disabled={link.isPending}
                      onClick={() => choose(deal.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {deal.dealNumber ? `#${deal.dealNumber} · ` : ""}
                          {contact
                            ? `${contact.firstName} ${contact.lastName}`
                            : "Unknown client"}
                          {isClientMatch ? (
                            <span className="ml-1.5 rounded border border-brand/30 bg-brand/10 px-1 py-px text-[10px] font-medium uppercase text-brand">
                              this client
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {stageLabel(deal.stage)} · {formatAddress(deal.address)}
                        </div>
                      </div>
                      {link.isPending ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {call?.dealId ? (
          <div className="flex justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">
              This call is already linked to a job.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              disabled={link.isPending}
              onClick={unlink}
            >
              Unlink
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
