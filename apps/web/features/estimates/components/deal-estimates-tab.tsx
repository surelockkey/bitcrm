"use client";

import { ChevronDown, Copy, FileSpreadsheet, Plus, Send } from "lucide-react";
import { useState } from "react";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { SendDocumentDialog } from "@/features/portal/components/send-document-dialog";
import { useCreateProposal, useDealEstimates, useDuplicateEstimate } from "../hooks";
import { EstimateEditor } from "./estimate-editor";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { NewEstimateDialog } from "./new-estimate-dialog";

const isOpen = (e: Pick<EstimateWithItems, "status">) => e.status === "unsent" || e.status === "pending";

/**
 * The job's Estimates tab as Workiz lays it out: every estimate of the job is
 * a tab ("Estimate 1", "Estimate 2", …), "+ Add estimate" makes a new one or a
 * copy, and "Send all (proposal)" sends the open ones together as a sales
 * proposal (good / better / best). The open estimate is controlled by the
 * page (URL `?estimate=`); with none in the URL the first one is shown.
 */
export function DealEstimatesTab({
  deal,
  estimateId,
  onEstimateChange,
  startCreating = false,
}: {
  deal: Deal;
  estimateId: string | null;
  onEstimateChange: (id: string | null) => void;
  /** Arrive with the New estimate dialog open (the client card's Create new → Estimate). */
  startCreating?: boolean;
}) {
  const { can } = usePermissions();
  const { data: estimates, isLoading, isError, error, refetch } = useDealEstimates(deal.id);
  const { data: jobProducts } = useDealProducts(deal.id);
  const duplicate = useDuplicateEstimate(deal.id);
  const proposal = useCreateProposal(deal.id);
  const [creating, setCreating] = useState(startCreating);
  const [sendingAll, setSendingAll] = useState(false);

  const canCreate = can("estimates", "create");
  const canSendAll = can("estimates", "send") && can("messages", "send");
  // Oldest first — "Estimate 1" is the first one made, as in Workiz.
  const list = [...(estimates ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // The page's choice wins even before the list has caught up with a just-created estimate.
  const currentId = estimateId ?? list[0]?.id ?? null;
  const current = list.find((e) => e.id === currentId) ?? null;
  const openOnes = list.filter((e) => isOpen(e) && !e.proposalId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load estimates")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }

  const addMenu = canCreate ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="text-brand hover:text-brand">
          <Plus /> Add estimate <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => setCreating(true)}>
          <Plus /> New estimate
        </DropdownMenuItem>
        {current ? (
          <DropdownMenuItem
            disabled={duplicate.isPending}
            onSelect={() => duplicate.mutate(current.id, { onSuccess: (e) => onEstimateChange(e.id) })}
          >
            <Copy /> Make a copy of #{current.number}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <div className="space-y-4">
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileSpreadsheet className="size-5" />
          </span>
          <h3 className="font-medium">No estimates yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Build one or more options for the client. Send them together as a proposal, and when they pick one, sync it to the job.
          </p>
          {canCreate ? (
            <Button variant="brand" size="sm" onClick={() => setCreating(true)}>
              <Plus /> New estimate
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-1 border-b" role="tablist" aria-label="Estimates">
            {list.map((e, i) => {
              const selected = currentId === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onEstimateChange(e.id)}
                  className={cn(
                    "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
                    selected
                      ? "border-foreground font-semibold"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>Estimate {i + 1}</span>
                  <span className="font-mono text-xs text-muted-foreground">#{e.number}</span>
                  {e.name ? <span className="hidden text-muted-foreground sm:inline">· {e.name}</span> : null}
                  <EstimateStatusBadge status={e.status} />
                </button>
              );
            })}
            {addMenu}
            {canSendAll && openOnes.length > 0 ? (
              <Button variant="outline" size="sm" className="mb-1 ml-auto" onClick={() => setSendingAll(true)}>
                <Send /> Send all (proposal)
              </Button>
            ) : null}
          </div>

          {currentId ? (
            <EstimateEditor key={currentId} estimateId={currentId} deal={deal} onOpenEstimate={onEstimateChange} />
          ) : null}
        </>
      )}

      {/* Mounted per opening so "copy job items" defaults from the current count. */}
      {creating ? (
        <NewEstimateDialog
          dealId={deal.id}
          jobItemCount={jobProducts?.length ?? deal.itemCount ?? 0}
          open
          onOpenChange={setCreating}
          onCreated={(e) => onEstimateChange(e.id)}
        />
      ) : null}

      {canSendAll && list[0] ? (
        <SendDocumentDialog
          open={sendingAll}
          onOpenChange={(o) => !o && setSendingAll(false)}
          channel="email"
          document={{
            kind: "proposal",
            id: deal.id,
            number: "",
            total: 0,
            contactId: list[0].contactId,
            dealId: deal.id,
            businessProfileId: deal.businessProfileId,
            alreadySent: false,
          }}
          markSent={() => proposal.mutateAsync()}
        />
      ) : null}
    </div>
  );
}
