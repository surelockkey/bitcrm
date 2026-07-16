"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Package, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDeal, useDeleteDeal } from "../hooks";
import { isUrgent } from "../lib";
import { PriorityFlag, StageBadge } from "./deal-badges";
import { DealStageStepper } from "./deal-stage-stepper";
import { DealSummary } from "./deal-summary";
import { DealNotesCard } from "./deal-notes-card";
import { DealProductsTab } from "./deal-products-tab";
import { DealTimelineTab } from "./deal-timeline-tab";
import { EditDealSheet } from "./edit-deal-sheet";

export function DealDetailPage({ dealId }: { dealId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const del = useDeleteDeal();
  const [editing, setEditing] = useState(false);

  if (isLoading || !deal) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const canDelete = can("deals", "delete");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Deals
        </Link>
        <span className="font-mono text-base font-semibold">#{deal.dealNumber}</span>
        <StageBadge stage={deal.stage} />
        {isUrgent(deal) ? <PriorityFlag /> : null}
        <span className="flex-1" />
        {canEdit ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
        {canDelete ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5 text-destructive"><Trash2 className="size-3.5" /> Delete</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete deal #{deal.dealNumber}?</AlertDialogTitle>
                <AlertDialogDescription>This soft-deletes the deal — it&apos;s archived and drops out of the pipeline.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={(e) => { e.preventDefault(); del.mutate(deal.id, { onSuccess: () => router.push("/deals") }); }}
                  className="bg-destructive text-white hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>

      {/* Body: main + activity rail */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-5 overflow-y-auto p-5">
          <DealStageStepper dealId={deal.id} stage={deal.stage} canEdit={canEdit} />
          <DealSummary deal={deal} canEdit={canEdit} />
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Package className="size-4" /> Products</h2>
            <DealProductsTab deal={deal} canEdit={canEdit} />
          </section>
          <DealNotesCard deal={deal} />
        </main>

        <aside className="flex min-h-0 flex-col border-t lg:border-l lg:border-t-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">Activity</div>
          <div className="flex-1 overflow-y-auto p-4">
            <DealTimelineTab dealId={deal.id} canEdit={canEdit} />
          </div>
        </aside>
      </div>

      {editing ? <EditDealSheet deal={deal} open={editing} onOpenChange={setEditing} /> : null}
    </div>
  );
}
