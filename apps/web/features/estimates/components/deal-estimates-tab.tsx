"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Loader2, Plus, Send, X } from "lucide-react";
import type { Deal, EstimateWithItems } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { formatMoney } from "@/features/billing/lib";
import { useDealEstimates, useDeleteEstimate, useDuplicateEstimate } from "../hooks";
import { ESTIMATE_STATUS_COLORS } from "@/features/reports/billing/lib";
import { EstimatesArt } from "@/features/deals/components/job-empty-art";
import { wzPill } from "@/components/workiz";
import { estimateStatusLabel, formatEstimateCreated, proposalSend } from "../lib";
import { byCreated, optionLabel } from "./estimate-tabs";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { SendProposalDialog } from "./send-proposal-dialog";


/** Each option keeps its colour down the left edge of its row (Workiz: green, blue, …). */
const ACCENTS = ["bg-chart3", "bg-brand", "bg-chart5", "bg-chart4", "bg-chart7", "bg-chart2"];
/** Workiz (jobshell_wz_MS9277_estimates): 14px/500 ink heads over a 1px ink rule, pad 0 0 15 21. */
const th = "border-b border-foreground pb-[15px] pl-[21px] text-left text-[14px] leading-4 font-medium text-foreground";
/** 13px cells, padding 20 10 20 20, a dotted rule on the left, #e6e6e6 under. */
const cell = "border-b border-l border-b-[#e6e6e6] border-l-[#cfcfcf] [border-left-style:dotted] py-5 pr-2.5 pl-5 align-middle text-[13px] leading-4 text-foreground";

/**
 * The job's Estimates tab as Workiz lays it out: a list of the job's
 * estimates — Estimate (its name / number), Created, Status, Total, and a copy
 * and a delete per row — with "+ Add Estimate" and our "Send all (Proposal)"
 * as outline pills under it. An estimate opens on its own page (`/estimates/[id]`),
 * where the job's estimates are tabs and "← Job ID" leads back here.
 */
export function DealEstimatesTab({
  deal,
  estimateId = null,
  startCreating = false,
}: {
  deal: Deal;
  /** From an older `?estimate=` link: that estimate now has a page of its own. */
  estimateId?: string | null;
  /** Kept for the page's API; the list no longer opens estimates in place. */
  onEstimateChange?: (id: string | null) => void;
  /** Arrive with the New estimate dialog open (the client card's Create new → Estimate). */
  startCreating?: boolean;
}) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: estimates, isLoading, isError, error, refetch } = useDealEstimates(deal.id);
  const { data: jobProducts } = useDealProducts(deal.id);
  const duplicate = useDuplicateEstimate(deal.id);
  const del = useDeleteEstimate(deal.id);
  const [creating, setCreating] = useState(startCreating);
  const [sendingAll, setSendingAll] = useState(false);
  const [deleting, setDeleting] = useState<EstimateWithItems | null>(null);

  useEffect(() => {
    if (estimateId && estimateId !== "new") router.replace(`/estimates/${encodeURIComponent(estimateId)}`);
  }, [estimateId, router]);

  const canCreate = can("estimates", "create");
  const canDelete = can("estimates", "delete");
  const canSendAll = can("estimates", "send") && can("messages", "send");
  const list = byCreated(estimates ?? []);
  const sendAll = proposalSend(list);

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load estimates")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Job estimates">
      {list.length === 0 ? (
        // Workiz's empty tab: the picture, the sentence, the pill under it,
        // and a rule closing the block (audit_pixels T7).
        <div className="flex flex-col items-center border-b border-[#e6e6e6] pt-[43px] pb-[54px]">
          <EstimatesArt />
          <h3 className="mt-[25px] text-[16px] leading-[25px] font-bold text-[#3e4b51]">You don&apos;t have any estimates yet</h3>
          {canCreate ? (
            <button type="button" className={cn(wzPill("outline", "tall"), "mt-5 w-[340px]")} onClick={() => setCreating(true)}>
              <Plus strokeWidth={1.5} /> Add Estimate
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="min-h-[61px] pt-3">
            <h3 className="text-[16px] leading-[19px] font-normal text-[#404040]">Estimates</h3>
          </div>
          <div className="mt-5 overflow-x-auto">
          {/* Fixed layout: Estimate and Created share what Status / Total /
              Actions (166px each) leave, as Workiz's 381 / 381 do. */}
          <table aria-label="Estimates" className="w-full min-w-[46rem] table-fixed border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={cn(th, "pl-[25px]")}>Estimate</th>
                <th className={th}>Created</th>
                <th className={cn(th, "w-[166px]")}>Status</th>
                <th className={cn(th, "w-[166px]")}>Total</th>
                <th className={cn(th, "w-[166px]")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e, i) => (
                // Workiz rows are 80px (jobshell_wz_MS9277_estimates).
                <tr key={e.id} className="h-20 hover:bg-[#f8f8f8]">
                  <td className="relative truncate border-b border-[#e6e6e6] py-5 pr-2.5 pl-6 align-middle text-[13px] leading-[19px]">
                    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", ACCENTS[i % ACCENTS.length])} />
                    <Link href={`/estimates/${e.id}`} className="font-semibold text-[#6aa8ee] hover:underline">
                      {optionLabel(e, i)}
                    </Link>
                    <span className="font-medium text-foreground"> / Estimate No. </span>
                    <span className="text-foreground opacity-60">{e.number}</span>
                  </td>
                  <td className={cell}>{formatEstimateCreated(e.createdAt)}</td>
                  <td className={cell}>
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: ESTIMATE_STATUS_COLORS[e.status] }} />
                      <span>{estimateStatusLabel(e.status)}</span>
                    </span>
                  </td>
                  <td className={cn(cell, "tabular-nums")}>{formatMoney(e.totals?.total ?? 0)}</td>
                  <td className={cell}>
                    {/* Workiz: a filled copy (14×17) at +54px and a filled grey ⊗ (16px) 46px on. */}
                    <div className="flex items-center gap-8 pl-[34px] text-[#9ea6aa]">
                      {canCreate ? (
                        <button
                          type="button"
                          aria-label={`Make a copy of estimate ${e.number}`}
                          title="Make a copy"
                          disabled={duplicate.isPending}
                          onClick={() => duplicate.mutate(e.id)}
                          className="hover:text-foreground disabled:opacity-50"
                        >
                          {duplicate.isPending && duplicate.variables === e.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Copy className="h-[17px] w-[14px]" strokeWidth={2.25} />
                          )}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          aria-label={`Delete estimate ${e.number}`}
                          title="Delete"
                          onClick={() => setDeleting(e)}
                          className="grid size-4 place-items-center rounded-full bg-[#9ea6aa] text-white hover:bg-destructive"
                        >
                          <X className="size-2.5" strokeWidth={3} />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {canCreate || (canSendAll && sendAll.mode) ? (
            // Workiz's outline pills under the table (+ Add Estimate, Load
            // proposal template); ours sends the job's estimates as one
            // proposal from the same row — Workiz has no such button.
            <div className="mt-[25px] flex flex-wrap gap-[15px] pl-[11px]">
              {canCreate ? (
                <button type="button" className={wzPill("outline", "tall")} onClick={() => setCreating(true)}>
                  <Plus strokeWidth={1.5} /> <span className="px-1">Add Estimate</span>
                </button>
              ) : null}
              {canSendAll && sendAll.mode ? (
                <button type="button" className={wzPill("outline", "tall")} onClick={() => setSendingAll(true)}>
                  <Send strokeWidth={1.5} /> <span className="px-1">Send all (Proposal)</span>
                </button>
              ) : null}
            </div>
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
          onCreated={(e) => router.push(`/estimates/${e.id}`)}
        />
      ) : null}

      {canSendAll && list[0] ? (
        <SendProposalDialog deal={deal} contactId={list[0].contactId} open={sendingAll} onOpenChange={setSendingAll} resend={sendAll.mode === "resend"} />
      ) : null}

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete estimate #{deleting?.number}?</AlertDialogTitle>
            <AlertDialogDescription>The estimate and its items are removed. The job&apos;s own items are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleting && del.mutate(deleting.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
