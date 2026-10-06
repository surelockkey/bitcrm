"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDuplicateEstimate } from "../hooks";
import { useEstimatePageData } from "../estimate-page-data";
import { EstimateEditor } from "./estimate-editor";
import { EstimateTabs, byCreated } from "./estimate-tabs";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { SendProposalDialog } from "./send-proposal-dialog";
import { proposalSend } from "../lib";


/**
 * `/estimates/[id]` — every estimate's own page, as in Workiz.
 * - A JOB's estimate: "← Job ID: …" back to the job's Estimates list, the
 *   job's estimates as tabs ("Estimate 1 · Estimate 2 · Add estimate"),
 *   Actions ▾ and Send ▾ (this estimate, or all of them as a proposal).
 * - A CLIENT's estimate (no job): the client layout — Client, Bill to, the
 *   estimate's number, name, date and status.
 *
 * Shown once, whole: one skeleton until the estimate, its job, the job's
 * other estimates, the client and the pickers' lists are all in.
 */
export function StandaloneEstimatePage({ estimateId }: { estimateId: string }) {
  const router = useRouter();
  const data = useEstimatePageData(estimateId);
  const { data: estimate, isError, error } = data.estimate;

  if (!data.ready) {
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

  if (estimate.dealId) {
    return (
      <JobEstimatePage
        estimate={estimate}
        dealId={estimate.dealId}
        deal={data.deal.data}
        siblings={data.siblings.data}
        jobItemCount={data.jobProducts.data?.length}
      />
    );
  }

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

function JobEstimatePage({
  estimate,
  dealId,
  deal,
  siblings,
  jobItemCount,
}: {
  estimate: EstimateWithItems;
  dealId: string;
  /** The page asked for these up front; they stay live through its own observers. */
  deal: Deal | undefined;
  siblings: EstimateWithItems[] | undefined;
  jobItemCount: number | undefined;
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const duplicate = useDuplicateEstimate(dealId);
  const [creating, setCreating] = useState(false);
  const [sendingAll, setSendingAll] = useState(false);

  const list = byCreated(siblings?.length ? siblings : [estimate]);
  const canSendAll = can("estimates", "send") && can("messages", "send");
  const sendAll = proposalSend(list);
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
            jobItemCount={jobItemCount}
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
            onSendAll={canSendAll && sendAll.mode && sendAll.count > 1 ? () => setSendingAll(true) : undefined}
          />
        ) : (
          // The job itself could not be loaded.
          <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            This estimate&apos;s job couldn&apos;t be loaded.
          </div>
        )}
      </div>

      {creating ? (
        <NewEstimateDialog
          dealId={dealId}
          jobItemCount={jobItemCount ?? deal?.itemCount ?? 0}
          open
          onOpenChange={setCreating}
          onCreated={(e) => router.push(`/estimates/${e.id}`)}
        />
      ) : null}
      {deal && canSendAll ? (
        <SendProposalDialog deal={deal} contactId={estimate.contactId} open={sendingAll} onOpenChange={setSendingAll} resend={sendAll.mode === "resend"} />
      ) : null}
    </div>
  );
}
