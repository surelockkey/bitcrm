"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ChevronLeft,
  Copy,
  Download,
  Eye,
  Loader2,
  PiggyBank,
  Send,
  Trash2,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
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
import { SignaturesSection } from "@/features/billing/components/signatures-section";
import { useDocumentSettings, useUpdateDocumentSettings } from "@/features/documents/hooks";
import { useContact } from "@/features/clients/hooks";
import { CopyPortalLinkButton } from "@/features/portal/components/copy-portal-link-button";
import { SendDocumentDialog, type SendDocumentChannel } from "@/features/portal/components/send-document-dialog";
import { getEstimateHtml, getEstimatePdfUrl } from "../api";
import {
  useDeleteEstimate,
  useDuplicateEstimate,
  useEstimate,
  useMarkEstimateSent,
  useSetEstimateStatus,
  useSignEstimate,
  useSyncEstimateToJob,
  useUpdateEstimate,
} from "../hooks";
import { estimateLocalTotals, estimateTitle, syncBlockReason, syncConfirmText } from "../lib";
import { estimateHeaderSchema, type EstimateHeaderValues } from "../schemas";
import { EstimateItemsTable } from "./estimate-items-table";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateStatusSelect } from "./estimate-status-select";
import { SetDepositDialog, depositLabel } from "./set-deposit-dialog";

/**
 * One estimate, edited in place — inside the job's Estimates tab (`deal`
 * given, `onBack` returns to the list) or on a client estimate's own page
 * (no `deal`: Workiz's "stub", which has no job to sync to).
 */
export function EstimateEditor({
  estimateId,
  deal,
  onBack,
  onOpenEstimate,
  onDeleted,
}: {
  estimateId: string;
  deal?: Deal;
  /** Back to the tab's list; absent on a page of its own (no "< Back" in page headers). */
  onBack?: () => void;
  onOpenEstimate: (id: string) => void;
  /** Where to go once the estimate is deleted; defaults to `onBack`. */
  onDeleted?: () => void;
}) {
  const { can } = usePermissions();
  const dealId = deal?.id;
  const { data: estimate, isLoading, isError, error, isFetching } = useEstimate(estimateId);
  const { data: jobProducts } = useDealProducts(dealId ?? "", !!dealId);
  const update = useUpdateEstimate(estimateId, dealId);
  const setStatus = useSetEstimateStatus(estimateId, dealId);
  const markSent = useMarkEstimateSent(estimateId, dealId);
  const duplicate = useDuplicateEstimate(dealId);
  const sync = useSyncEstimateToJob(estimateId, dealId);
  const del = useDeleteEstimate(dealId);
  const sign = useSignEstimate(estimateId, dealId);
  const saveDefaults = useUpdateDocumentSettings();
  const afterDelete = onDeleted ?? onBack;
  const pdf = useOpenPdf(() => getEstimatePdfUrl(estimateId));
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sendingVia, setSendingVia] = useState<SendDocumentChannel | null>(null);
  const client = useContact(estimate?.contactId ?? "");
  // Loaded once for the Send panel's defaults; the deposit dialog writes it.
  useDocumentSettings();

  const items = useMemo(() => estimate?.items ?? [], [estimate?.items]);
  const localTotals = useMemo(
    () => (estimate ? estimateLocalTotals(estimate, items) : null),
    [estimate, items],
  );

  const back = onBack ? (
    <Button variant="ghost" size="sm" className="-ml-2 gap-1" onClick={onBack}>
      <ChevronLeft /> All estimates
    </Button>
  ) : null;

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
  const canText = canSend && can("messages", "send");
  const canDelete = can("estimates", "delete");
  const syncBlocked = syncBlockReason(estimate, items.length, can("estimates", "sync"), !!deal);
  const jobItemCount = jobProducts?.length ?? deal?.itemCount ?? 0;
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
          {estimate.approvedVia === "portal" ? <Badge variant="outline">Signed on the portal</Badge> : null}
          {estimate.proposalId ? <Badge variant="outline">In a proposal</Badge> : null}
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
          {canText ? (
            <Button variant="brand" size="sm" onClick={() => setSendingVia("sms")}>
              <Send /> Send
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

      <EstimateItemsTable estimateId={estimate.id} dealId={dealId} items={items} canEdit={canEdit} />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border px-4 py-3 text-sm">
        <PiggyBank className="size-4 text-muted-foreground" aria-hidden />
        <span className="font-medium">Deposit</span>
        <span className="text-muted-foreground">
          {depositLabel({ ...estimate, totals }) ?? "None — the client approves without paying"}
        </span>
        {canEdit ? (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => setDepositOpen(true)}>
            Set deposit
          </Button>
        ) : null}
      </div>

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

      <SignaturesSection
        signatures={estimate.signatures ?? []}
        signerName={[client.data?.firstName, client.data?.lastName].filter(Boolean).join(" ")}
        canSign={canEdit}
        saving={sign.isPending}
        onSign={(input) => sign.mutateAsync(input)}
      />

      <SetDepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        total={totals.total}
        current={estimate}
        canSetDefault={can("settings", "edit")}
        saving={update.isPending || saveDefaults.isPending}
        onSave={async (patch, setForFuture) => {
          await update.mutateAsync(patch);
          if (setForFuture) await saveDefaults.mutateAsync(patch);
          setDepositOpen(false);
        }}
      />

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

      {canText ? (
        <SendDocumentDialog
          channel={sendingVia ?? "sms"}
          open={sendingVia !== null}
          onOpenChange={(o) => !o && setSendingVia(null)}
          document={{
            kind: "estimate",
            id: estimate.id,
            number: estimate.number,
            total: estimate.totals?.total ?? 0,
            contactId: estimate.contactId,
            dealId,
            businessProfileId: deal?.businessProfileId,
            alreadySent: !!estimate.sentAt,
            display: estimate.display,
          }}
          markSent={() => markSent.mutateAsync(true)}
        />
      ) : null}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete estimate #{estimate.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deal
                ? "The estimate and its items are removed. The job's own items are not affected."
                : "The estimate and its items are removed from the client's card."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => del.mutate(estimate.id, { onSuccess: afterDelete })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
