"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ChevronLeft,
  Copy,
  Download,
  Eye,
  Loader2,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { formatYmd } from "@/features/billing/dates";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitInput, CommitTextarea, DocField } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { SentBadge } from "@/features/invoices/components/sent-badge";
import { CopyPortalLinkButton } from "@/features/portal/components/copy-portal-link-button";
import { getEstimateHtml, getEstimatePdfUrl } from "../api";
import {
  useDeleteEstimate,
  useDuplicateEstimate,
  useEstimate,
  useMarkEstimateSent,
  useSetEstimateStatus,
  useSyncEstimateToJob,
  useUpdateEstimate,
} from "../hooks";
import { estimateLocalTotals, estimateTitle, syncBlockReason, syncConfirmText } from "../lib";
import { estimateHeaderSchema, type EstimateHeaderValues } from "../schemas";
import { EstimateItemsTable } from "./estimate-items-table";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateStatusSelect } from "./estimate-status-select";

/** One estimate, edited in place inside the job's Estimates tab. */
export function EstimateEditor({
  estimateId,
  deal,
  onBack,
  onOpenEstimate,
}: {
  estimateId: string;
  deal: Deal;
  onBack: () => void;
  onOpenEstimate: (id: string) => void;
}) {
  const { can } = usePermissions();
  const { data: estimate, isLoading, isError, error, isFetching } = useEstimate(estimateId);
  const { data: jobProducts } = useDealProducts(deal.id);
  const update = useUpdateEstimate(estimateId, deal.id);
  const setStatus = useSetEstimateStatus(estimateId, deal.id);
  const markSent = useMarkEstimateSent(estimateId, deal.id);
  const duplicate = useDuplicateEstimate(deal.id);
  const sync = useSyncEstimateToJob(estimateId, deal.id);
  const del = useDeleteEstimate(deal.id);
  const pdf = useOpenPdf(() => getEstimatePdfUrl(estimateId));
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const items = useMemo(() => estimate?.items ?? [], [estimate?.items]);
  const localTotals = useMemo(
    () => (estimate ? estimateLocalTotals(estimate, items) : null),
    [estimate, items],
  );

  const back = (
    <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onBack}>
      <ChevronLeft /> All estimates
    </Button>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {back}
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !estimate || !localTotals) {
    return (
      <div className="space-y-3">
        {back}
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {getApiErrorMessage(error, "This estimate couldn't be loaded — it may have been deleted.")}
        </div>
      </div>
    );
  }

  const canEdit = can("estimates", "edit");
  const canSend = can("estimates", "send");
  const canCreate = can("estimates", "create");
  const canDelete = can("estimates", "delete");
  const syncBlocked = syncBlockReason(estimate, items.length, can("estimates", "sync"));
  const jobItemCount = jobProducts?.length ?? deal.itemCount ?? 0;
  // Server totals lag item edits by a refetch; the shared formula bridges it.
  const totals = isFetching ? localTotals : estimate.totals ?? localTotals;

  const saveHeader = (patch: Partial<EstimateHeaderValues>) => {
    const parsed = estimateHeaderSchema.partial().safeParse(patch);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid estimate details");
      return;
    }
    update.mutate(parsed.data);
  };

  return (
    <div className="space-y-4">
      {back}

      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{estimateTitle(estimate)}</h2>
          <EstimateStatusBadge status={estimate.status} />
          <SentBadge sentAt={estimate.sentAt} />
          <span className="ml-auto text-xs text-muted-foreground">Created {formatYmd(estimate.createdAt)}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DocField label="Name" htmlFor="estimate-name-edit">
            <CommitInput
              id="estimate-name-edit"
              value={estimate.name ?? ""}
              placeholder="e.g. Good"
              maxLength={120}
              disabled={!canEdit}
              onCommit={(name) => saveHeader({ name: name.trim() })}
            />
          </DocField>
          <DocField label="Estimate date" htmlFor="estimate-date">
            <CommitInput
              id="estimate-date"
              type="date"
              value={estimate.estimateDate}
              disabled={!canEdit}
              onCommit={(estimateDate) => estimateDate && saveHeader({ estimateDate })}
            />
          </DocField>
          <DocField label="Status" htmlFor="estimate-status">
            <EstimateStatusSelect
              id="estimate-status"
              value={estimate.status}
              disabled={!canEdit || setStatus.isPending}
              onChange={(s) => s !== estimate.status && setStatus.mutate(s)}
            />
          </DocField>
          <DocField label="Template" htmlFor="estimate-template">
            <DocumentTemplateSelect
              id="estimate-template"
              kind="estimate"
              value={estimate.templateId}
              disabled={!canEdit}
              onChange={(templateId) => update.mutate({ templateId })}
            />
          </DocField>
        </div>

        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          <Button variant="outline" size="sm" onClick={() => setPreviewing(true)}>
            <Eye /> Preview
          </Button>
          <Button variant="outline" size="sm" onClick={pdf.open} disabled={pdf.pending}>
            {pdf.pending ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
          {canSend ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markSent.isPending}
              onClick={() => markSent.mutate(!estimate.sentAt)}
            >
              {markSent.isPending ? <Loader2 className="animate-spin" /> : estimate.sentAt ? <Undo2 /> : <Send />}
              {estimate.sentAt ? "Mark as unsent" : "Mark as sent"}
            </Button>
          ) : null}
          {canSend ? <CopyPortalLinkButton contactId={estimate.contactId} /> : null}
          {canCreate ? (
            <Button
              variant="outline"
              size="sm"
              disabled={duplicate.isPending}
              onClick={() => duplicate.mutate(estimate.id, { onSuccess: (e) => onOpenEstimate(e.id) })}
            >
              {duplicate.isPending ? <Loader2 className="animate-spin" /> : <Copy />} Duplicate
            </Button>
          ) : null}
          {syncBlocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="brand"
                  size="sm"
                  aria-disabled="true"
                  className="cursor-not-allowed opacity-50"
                  onClick={(e) => e.preventDefault()}
                >
                  <ArrowLeftRight /> Sync to job
                </Button>
              </TooltipTrigger>
              <TooltipContent>{syncBlocked}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="brand" size="sm" onClick={() => setSyncing(true)} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />} Sync to job
            </Button>
          )}
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => setDeleting(true)}
              aria-label="Delete estimate"
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
        </div>
      </section>

      <EstimateItemsTable estimateId={estimate.id} dealId={deal.id} items={items} canEdit={canEdit} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <DocField label="Estimate notes" htmlFor="estimate-notes" className="sm:flex-1">
          <CommitTextarea
            id="estimate-notes"
            rows={4}
            maxLength={5000}
            placeholder="Shown on the estimate (scope, warranty, validity…)"
            value={estimate.notes ?? ""}
            disabled={!canEdit}
            onCommit={(notes) => saveHeader({ notes })}
          />
        </DocField>
        <DocumentSummaryPanel
          totals={totals}
          taxRateId={estimate.taxRateId}
          taxRateName={estimate.taxRateName}
          taxSource={estimate.taxSource}
          discount={estimate.discount}
          canEdit={canEdit}
          pending={update.isPending && (update.variables?.taxRateId !== undefined || update.variables?.discount !== undefined)}
          onTaxChange={(taxRateId) => update.mutate({ taxRateId })}
          onDiscountChange={(discount) => update.mutate({ discount })}
        />
      </div>

      <DocumentPreviewDialog
        open={previewing}
        onOpenChange={setPreviewing}
        title={estimateTitle(estimate)}
        queryKey={queryKeys.estimates.detail(estimate.id)}
        fetchHtml={() => getEstimateHtml(estimate.id)}
        onDownload={pdf.open}
        downloadPending={pdf.pending}
      />

      <AlertDialog open={syncing} onOpenChange={setSyncing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sync estimate #{estimate.number} to the job?</AlertDialogTitle>
            <AlertDialogDescription>{syncConfirmText(jobItemCount, items.length)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => sync.mutate()}>Replace job items</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete estimate #{estimate.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              The estimate and its items are removed. The job&apos;s own items are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => del.mutate(estimate.id, { onSuccess: onBack })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
