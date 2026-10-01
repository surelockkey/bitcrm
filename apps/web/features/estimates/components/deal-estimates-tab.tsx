"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileSpreadsheet, Loader2, Plus, Send, XCircle } from "lucide-react";
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
import { formatEstimateCreated } from "../lib";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { byCreated, optionLabel } from "./estimate-tabs";
import { NewEstimateDialog } from "./new-estimate-dialog";
import { SendProposalDialog } from "./send-proposal-dialog";

const isOpen = (e: Pick<EstimateWithItems, "status">) => e.status === "unsent" || e.status === "pending";

/** Each option keeps its colour down the left edge of its row (Workiz: green, blue, …). */
const ACCENTS = ["bg-chart3", "bg-brand", "bg-chart5", "bg-chart4", "bg-chart7", "bg-chart2"];
const th = "border-b border-foreground/70 px-4 pb-3 text-left text-[15px] font-medium";
const cell = "border-b border-l border-dashed px-4 py-5 align-middle";
/** Workiz's outline pill ("+ Add Estimate"). */
const pill = "h-10 rounded-pill border-foreground/70 px-5 font-semibold";

/**
 * The job's Estimates tab as Workiz lays it out: a list of the job's
 * estimates — Estimate (its name / number), Created, Status, Total, and a copy
 * and a delete per row — with "Send all (Proposal)" over it and "+ Add
 * Estimate" under it. An estimate opens on its own page (`/estimates/[id]`),
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
  const openOnes = list.filter((e) => isOpen(e) && !e.proposalId);

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
    <section aria-label="Job estimates" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg">Estimates</h3>
        {canSendAll && openOnes.length > 0 ? (
          <Button variant="default" size="lg" className="h-9 rounded-pill px-5 font-semibold" onClick={() => setSendingAll(true)}>
            <Send /> Send all (Proposal)
          </Button>
        ) : null}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileSpreadsheet className="size-5" />
          </span>
          <h4 className="font-medium">No estimates yet</h4>
          <p className="max-w-sm text-sm text-muted-foreground">
            Build one or more options for the client. Send them together as a proposal, and when they pick one, sync it to the job.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table aria-label="Estimates" className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className={cn(th, "pl-6")}>Estimate</th>
                <th className={th}>Created</th>
                <th className={cn(th, "w-40")}>Status</th>
                <th className={cn(th, "w-40")}>Total</th>
                <th className={cn(th, "w-36")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((e, i) => (
                <tr key={e.id} className="hover:bg-muted/40">
                  <td className="relative border-b border-dashed py-5 pr-4 pl-6 align-middle">
                    <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", ACCENTS[i % ACCENTS.length])} />
                    <Link href={`/estimates/${e.id}`} className="font-medium text-brand hover:underline">
                      {optionLabel(e, i)}
                    </Link>
                    <span className="text-muted-foreground"> / Estimate No. </span>
                    <span className="text-muted-foreground">{e.number}</span>
                  </td>
                  <td className={cell}>{formatEstimateCreated(e.createdAt)}</td>
                  <td className={cell}>
                    <EstimateStatusBadge status={e.status} />
                  </td>
                  <td className={cn(cell, "font-mono tabular-nums")}>{formatMoney(e.totals?.total ?? 0)}</td>
                  <td className={cell}>
                    <div className="flex items-center gap-4 text-muted-foreground">
                      {canCreate ? (
                        <button
                          type="button"
                          aria-label={`Make a copy of estimate ${e.number}`}
                          title="Make a copy"
                          disabled={duplicate.isPending}
                          onClick={() => duplicate.mutate(e.id)}
                          className="hover:text-foreground disabled:opacity-50"
                        >
                          {duplicate.isPending && duplicate.variables === e.id ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          aria-label={`Delete estimate ${e.number}`}
                          title="Delete"
                          onClick={() => setDeleting(e)}
                          className="hover:text-destructive"
                        >
                          <XCircle className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canCreate ? (
        <div className="flex flex-wrap gap-3">
          <Button variant="outline" size="lg" className={pill} onClick={() => setCreating(true)}>
            <Plus /> Add Estimate
          </Button>
        </div>
      ) : null}

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
        <SendProposalDialog deal={deal} contactId={list[0].contactId} open={sendingAll} onOpenChange={setSendingAll} />
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
