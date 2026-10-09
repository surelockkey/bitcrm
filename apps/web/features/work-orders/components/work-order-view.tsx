"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Loader2, Trash2, Upload, Wrench } from "lucide-react";
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
import type { WzMenuAction } from "@/components/workiz/menu";
import { WzLegacyActionsMenu } from "@/components/workiz/legacy-actions-menu";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/billing/components/list-bits";
import { useDefaultBusinessProfile } from "@/features/business-profiles/hooks";
import { useCompany } from "@/features/clients/hooks";
import { useDealsByIds } from "@/features/deals/hooks";
import { useDeleteWorkOrder, useUploadWorkOrderDocument, useWorkOrder, useWorkOrderDocument } from "../hooks";
import { WorkOrderPaper } from "./work-order-paper";

/*
 * Workiz's work order page (`/root/work_order/<job>/`, what a job's Actions →
 * View Work Order opens; pg_workorders_wz_01/_03/_05, measured in its iframe):
 *   h3     "Work Order #5TU7ZA" 20px/25px 400 #3e4b51;
 *   h4     "Client: <name>" 16px/19px 400 #404040, 8px under it, the name an
 *          ink link to the client;
 *   right  "Actions ⌄" level with the h3, 20px off the edge (Workiz's yellow
 *          "Send" beside it is left out: BitCRM does not mail work orders);
 *   frame  8px under the h4, 20px in from both sides: 1px #ccc, 20px in,
 *          880px tall — Workiz's PDF viewer of the document.
 * Workiz's "← Job #5TU7ZA" over the h3 is a back link, which BitCRM headers
 * never carry: the job is Actions → View Job, as in Workiz's own menu.
 */
const FRAME = "mx-4 mt-2 mb-5 min-h-[922px] border border-input p-2.5 sm:mx-5 sm:p-5";

export function WorkOrderView({ id }: { id: string }) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("work_orders", "view");
  const seesJobs = can("deals", "view");
  // "Upload file" clicks the hidden picker by its id — a ref read while the menu is built is a render-time read.
  const fileInputId = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const woQuery = useWorkOrder(id, canView);
  const wo = woQuery.data ?? undefined;
  const companyQuery = useCompany(wo?.companyId ?? "");
  const businessQuery = useDefaultBusinessProfile(!!wo);
  const dealsQuery = useDealsByIds(wo?.dealId ? [wo.dealId] : [], seesJobs);
  const documentQuery = useWorkOrderDocument(id, !!wo?.s3Key);
  const upload = useUploadWorkOrderDocument();
  const del = useDeleteWorkOrder();

  // The header, the paper and its file come up together: the client's name,
  // the letterhead, the job's number and the document's link are each a
  // request of their own once the work order has answered.
  const ready = usePageReady(
    !permsLoading &&
      settled(woQuery) &&
      (woQuery.data === null ||
        (settled(companyQuery) && settled(businessQuery) && settled(dealsQuery) && settled(documentQuery))),
    id,
  );

  if (denied("work_orders", "view")) return <NoAccess what="work orders" />;
  if (!ready) return <WorkOrderSkeleton />;
  if (!wo) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-wz-strong">
        <h2 className="text-lg font-medium">Work order not found</h2>
        <p className="text-sm text-wz-caption">It may have been deleted.</p>
      </div>
    );
  }

  const company = companyQuery.data;
  const jobNumber = seesJobs ? dealsQuery.data?.find((d) => d.id === wo.dealId)?.dealNumber : undefined;
  const documentUrl = documentQuery.data ?? null;

  const actions: WzMenuAction[] = [
    ...(wo.dealId && seesJobs ? [{ key: "job", label: "View Job", icon: Wrench, onSelect: () => router.push(`/deals/${wo.dealId}`) }] : []),
    ...(documentUrl
      ? [{ key: "download", label: "Download", icon: Download, onSelect: () => window.open(documentUrl, "_blank", "noopener,noreferrer") }]
      : []),
    ...(can("work_orders", "edit")
      ? [{ key: "upload", label: "Upload file", icon: Upload, disabled: upload.isPending, onSelect: () => document.getElementById(fileInputId)?.click() }]
      : []),
    ...(can("work_orders", "delete")
      ? [{ key: "delete", label: "Delete", icon: Trash2, destructive: true, onSelect: () => setConfirmDelete(true) }]
      : []),
  ];

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="work-order-scroller">
      <div className="flex items-start gap-4 px-4 pt-[17px] sm:px-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] leading-[25px] font-normal text-wz-tab-bar">Work Order #{wo.woNumber}</h1>
          <p className="mt-2 truncate text-base leading-[19px]">
            <span>Client:</span>{" "}
            {company ? (
              can("companies", "view") ? (
                <Link href={`/companies/${company.id}`} className="text-foreground no-underline hover:underline">
                  {company.title}
                </Link>
              ) : (
                <span className="text-foreground">{company.title}</span>
              )
            ) : null}
          </p>
        </div>
        {actions.length ? <WzLegacyActionsMenu items={actions} /> : null}
      </div>

      <div className={FRAME} data-slot="work-order-frame">
        <WorkOrderPaper workOrder={wo} company={company} business={businessQuery.data} jobNumber={jobNumber} />
        {documentUrl ? (
          // The client's own WO, as the browser's PDF viewer shows it — what Workiz's frame holds.
          <iframe
            src={documentUrl}
            title={`Work order ${wo.woNumber} document`}
            className="mt-5 block h-[880px] w-full border border-input"
          />
        ) : null}
      </div>

      <input
        id={fileInputId}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate({ id: wo.id, file });
        }}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete work order?</AlertDialogTitle>
            <AlertDialogDescription>
              {wo.dealId
                ? `${wo.woNumber} authorized a job, so it is archived rather than deleted.`
                : `${wo.woNumber} will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={del.isPending}
              onClick={(e) => {
                e.preventDefault();
                del.mutate(wo.id, {
                  onSuccess: () => {
                    setConfirmDelete(false);
                    router.push("/work-orders");
                  },
                });
              }}
            >
              {del.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** The page before its first frame: the header's lines and the frame, empty. */
function WorkOrderSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto" aria-busy="true" aria-label="Loading work order">
      <div className="flex items-start gap-4 px-4 pt-[17px] sm:px-5">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-[25px] w-64" />
          <Skeleton className="mt-2 h-[19px] w-48" />
        </div>
        <Skeleton className="h-[34px] w-[112px] rounded-[15px]" />
      </div>
      <div className={FRAME} />
    </div>
  );
}
