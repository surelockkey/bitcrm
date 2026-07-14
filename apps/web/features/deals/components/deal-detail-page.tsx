"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useDeal, useDealProducts, useDeleteDeal } from "../hooks";
import { isUrgent } from "../lib";
import { PriorityFlag, StageBadge } from "./deal-badges";
import { StageMenu } from "./stage-menu";
import { DealOverviewTab } from "./deal-overview-tab";
import { DealProductsTab } from "./deal-products-tab";
import { DealTimelineTab } from "./deal-timeline-tab";
import { EditDealSheet } from "./edit-deal-sheet";

export function DealDetailPage({ dealId }: { dealId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const { data: products } = useDealProducts(dealId);
  const del = useDeleteDeal();
  const [editing, setEditing] = useState(false);

  if (isLoading || !deal) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const canDelete = can("deals", "delete");

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <Link href="/deals" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Deals
        </Link>
        <span className="font-mono text-base font-semibold">#{deal.dealNumber}</span>
        <StageBadge stage={deal.stage} />
        {isUrgent(deal) ? <PriorityFlag /> : null}
        <span className="flex-1" />
        {canEdit ? <StageMenu dealId={deal.id} /> : null}
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

      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="overview" className="flex flex-col">
          <div className="border-b px-5">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="overview" className="px-2">Overview</TabsTrigger>
              <TabsTrigger value="products" className="px-2">Products · {products?.length ?? 0}</TabsTrigger>
              <TabsTrigger value="timeline" className="px-2">Timeline</TabsTrigger>
            </TabsList>
          </div>
          <div className="p-5">
            <TabsContent value="overview" className="mt-0"><DealOverviewTab deal={deal} canEdit={canEdit} /></TabsContent>
            <TabsContent value="products" className="mt-0"><DealProductsTab deal={deal} canEdit={canEdit} /></TabsContent>
            <TabsContent value="timeline" className="mt-0"><DealTimelineTab dealId={deal.id} canEdit={canEdit} /></TabsContent>
          </div>
        </Tabs>
      </div>

      {editing ? <EditDealSheet deal={deal} open={editing} onOpenChange={setEditing} /> : null}
    </div>
  );
}
