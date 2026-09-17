"use client";

import { ChevronRight, FileSpreadsheet, Plus } from "lucide-react";
import { useState } from "react";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { SentBadge } from "@/features/invoices/components/sent-badge";
import { useDealEstimates } from "../hooks";
import { EstimateEditor } from "./estimate-editor";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { NewEstimateDialog } from "./new-estimate-dialog";

/**
 * The job's Estimates tab: a list of estimate cards, or one estimate open in
 * the editor. The open estimate is controlled by the page (URL `?estimate=`).
 */
export function DealEstimatesTab({
  deal,
  estimateId,
  onEstimateChange,
}: {
  deal: Deal;
  estimateId: string | null;
  onEstimateChange: (id: string | null) => void;
}) {
  const { can } = usePermissions();
  const { data: estimates, isLoading, isError, error, refetch } = useDealEstimates(deal.id);
  const { data: jobProducts } = useDealProducts(deal.id);
  const [creating, setCreating] = useState(false);

  if (estimateId) {
    return (
      <EstimateEditor
        key={estimateId}
        estimateId={estimateId}
        deal={deal}
        onBack={() => onEstimateChange(null)}
        onOpenEstimate={onEstimateChange}
      />
    );
  }

  const canCreate = can("estimates", "create");
  const list = [...(estimates ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {list.length ? `${list.length} estimate${list.length === 1 ? "" : "s"}` : "Estimates for this job"}
        </p>
        {canCreate ? (
          <Button variant="brand" size="sm" onClick={() => setCreating(true)}>
            <Plus /> New estimate
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>{getApiErrorMessage(error, "Couldn't load estimates")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileSpreadsheet className="size-5" />
          </span>
          <h3 className="font-medium">No estimates yet</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            Build one or more options for the client. When they pick one, sync it to the job.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((e) => (
            <li key={e.id}>
              <EstimateCard estimate={e} onOpen={() => onEstimateChange(e.id)} />
            </li>
          ))}
        </ul>
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
    </div>
  );
}

function EstimateCard({ estimate, onOpen }: { estimate: EstimateWithItems; onOpen: () => void }) {
  const count = estimate.items?.length ?? estimate.totals?.lineCount ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-sm font-semibold">#{estimate.number}</span>
          {estimate.name ? <span className="truncate text-sm font-medium">{estimate.name}</span> : null}
          <EstimateStatusBadge status={estimate.status} />
          <SentBadge sentAt={estimate.sentAt} />
        </div>
        <div className="text-xs text-muted-foreground">
          {formatYmd(estimate.estimateDate)} · {count} item{count === 1 ? "" : "s"}
        </div>
      </div>
      <span className="font-mono text-sm font-semibold tabular-nums">{formatMoney(estimate.totals?.total ?? 0)}</span>
      <ChevronRight className="size-4 flex-none text-muted-foreground" />
    </button>
  );
}
