"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { EstimateWithItems } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDeal, useDealProducts } from "@/features/deals/hooks";
import { useDealEstimates, useDuplicateEstimate, useEstimate } from "../hooks";
import { EstimateEditor } from "./estimate-editor";
import { EstimateTabs, byCreated } from "./estimate-tabs";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { SendProposalDialog } from "./send-proposal-dialog";

const isOpen = (e: Pick<EstimateWithItems, "status" | "proposalId">) =>
  (e.status === "unsent" || e.status === "pending") && !e.proposalId;

/**
 * `/estimates/[id]` — every estimate's own page, as in Workiz.
 * - A JOB's estimate: "← Job ID: …" back to the job's Estimates list, the
 *   job's estimates as tabs ("Estimate 1 · Estimate 2 · Add estimate"),
 *   Actions ▾ and Send ▾ (this estimate, or all of them as a proposal).
 * - A CLIENT's estimate (no job): the client layout — Client, Bill to, the
 *   estimate's number, name, date and status.
 */
export function StandaloneEstimatePage({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const { data: estimate, isLoading, isError, error } = useEstimate(estimateId);

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !estimate) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {getApiErrorMessage(error, "This estimate couldn't be loaded — it may have been deleted.")}
        </div>
      </div>
    );
  }

  if (estimate.dealId) return <JobEstimatePage estimate={estimate} dealId={estimate.dealId} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="p-6">
        <EstimateEditor
          estimateId={estimateId}
          onOpenEstimate={(id) => router.push(`/estimates/${id}`)}
          onDeleted={() => router.push(`/contacts/${estimate.contactId}`)}
        />
      </div>
    </div>
  );
}

function JobEstimatePage({ estimate, dealId }: { estimate: EstimateWithItems; dealId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: deal } = useDeal(dealId);
  const { data: jobProducts } = useDealProducts(dealId);
  const { data: siblings } = useDealEstimates(dealId);
  const duplicate = useDuplicateEstimate(dealId);
  const [creating, setCreating] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const list = byCreated(siblings?.length ? siblings : [estimate]);
  const canSendAll = can("estimates", "send") && can("messages", "send");
  const openOnes = list.filter(isOpen);
  const back = `/deals/${dealId}?tab=estimates`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="px-6 pt-5">
        <Link href={back} className="inline-flex items-center gap-2 text-[15px] hover:underline">
          <ArrowLeft className="size-4" aria-hidden /> Job ID: {estimate.dealNumber ?? deal?.dealNumber ?? ""}
        </Link>
      </div>
      <div className="p-6 pt-3">
        {deal ? (
          <EstimateEditor
            key={estimate.id}
            estimateId={estimate.id}
            deal={deal}
            tabs={
              <EstimateTabs
                estimates={list}
                currentId={estimate.id}
                canCreate={can("estimates", "create")}
                onNew={() => setCreating(true)}
                onCopy={() => duplicate.mutate(estimate.id, { onSuccess: (e) => router.push(`/estimates/${e.id}`) })}
                copying={duplicate.isPending}
              />
            }
            onOpenEstimate={(id) => router.push(`/estimates/${id}`)}
            onDeleted={() => router.push(back)}
            onSendAll={canSendAll && openOnes.length > 1 ? () => setSendingAll(true) : undefined}
          />
        ) : (
          <Skeleton className="h-48 w-full" />
        )}
      </div>

      {creating ? (
        <NewEstimateDialog
          dealId={dealId}
          jobItemCount={jobProducts?.length ?? deal?.itemCount ?? 0}
          open
          onOpenChange={setCreating}
          onCreated={(e) => router.push(`/estimates/${e.id}`)}
        />
      ) : null}
      {deal && canSendAll ? (
        <SendProposalDialog deal={deal} contactId={estimate.contactId} open={sendingAll} onOpenChange={setSendingAll} />
      ) : null}
    </div>
  );
}
