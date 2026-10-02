"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  BookOpen,
  Briefcase,
  ChevronDown,
  Copy,
  Download,
  Eye,
  Link2,
  Loader2,
  Send,
  StickyNote,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { SyncToJobDialog } from "./sync-to-job-dialog";
import { formatMoney } from "@/features/billing/lib";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitInput, CommitTextarea, DocField } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentSummaryPanel, Row } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { SignaturesSection } from "@/features/billing/components/signatures-section";
import { useContact } from "@/features/clients/hooks";
import { contactName, formatAddress } from "@/features/clients/lib";
import { useDocumentSettings, useUpdateDocumentSettings } from "@/features/documents/hooks";
import { SentBadge } from "@/features/invoices/components/sent-badge";
import { CopyPortalLinkButton, useCopyPortalLink } from "@/features/portal/components/copy-portal-link-button";
import { SendDocumentDialog } from "@/features/portal/components/send-document-dialog";
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
import { estimateLocalTotals, estimateTitle, syncBlockReason } from "../lib";
import { estimateHeaderSchema, type EstimateHeaderValues } from "../schemas";
import { EstimateCoverField } from "./estimate-cover-field";
import { EstimateItemsTable } from "./estimate-items-table";
import { EstimateStatusBadge } from "./estimate-status-badge";
import { EstimateStatusSelect } from "./estimate-status-select";
import { SetDepositDialog, depositLabel } from "./set-deposit-dialog";

/** Workiz's outline pill ("Actions ▾", "Price book", "Sync to Job"). */
const pill = "h-9 rounded-pill border-foreground/60 px-4 font-semibold";

/**
 * One estimate, laid out as Workiz lays its estimate page out. Two layouts,
 * as there:
 * - a JOB's estimate (`deal` given): the job's estimates as tabs with
 *   Actions ▾ and the yellow Send; a band with the cover image, the
 *   description, the client's details, the service address, the status and
 *   the estimate's number; Items with Add item / Price book / Sync to job /
 *   Create new job;
 * - a CLIENT's estimate (no job): "Client: …" with Actions ▾ and Send on a
 *   grey band, "Bill to:" on the left and Estimate / Estimate name / Date /
 *   Status on the right; Items with Add item / Price book, and Actions → Copy
 *   to job.
 * Then the totals, Notes and Signatures, the same for both.
 */
export function EstimateEditor({
  estimateId,
  deal,
  tabs,
  onOpenEstimate,
  onDeleted,
  onSendAll,
}: {
  estimateId: string;
  deal?: Deal;
  /** The job's estimate tabs, rendered left of Actions / Send (Workiz). Absent on a page of its own. */
  tabs?: ReactNode;
  onOpenEstimate: (id: string) => void;
  /** Where to go once the estimate is deleted. */
  onDeleted?: () => void;
  /** Workiz "Send > Send all (proposal)": given when the job has open estimates to send together. */
  onSendAll?: () => void;
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
  const pdf = useOpenPdf(() => getEstimatePdfUrl(estimateId));
  const [previewing, setPreviewing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const portalLink = useCopyPortalLink(estimate?.contactId ?? "");
  const [deleting, setDeleting] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const client = useContact(estimate?.contactId ?? "");
  // Loaded once for the Send panel's defaults; the deposit dialog writes it.
  useDocumentSettings();

  const items = useMemo(() => estimate?.items ?? [], [estimate?.items]);
  const localTotals = useMemo(() => (estimate ? estimateLocalTotals(estimate, items) : null), [estimate, items]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !estimate || !localTotals) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {getApiErrorMessage(error, "This estimate couldn't be loaded — it may have been deleted.")}
      </div>
    );
  }

  const canEdit = can("estimates", "edit");
  const canSend = can("estimates", "send");
  const canCreate = can("estimates", "create");
  const canText = canSend && can("messages", "send");
  const canDelete = can("estimates", "delete");
  const canSync = can("estimates", "sync");
  const syncBlocked = syncBlockReason(estimate, items.length, canSync, !!deal);
  const jobItemCount = jobProducts?.length ?? deal?.itemCount ?? 0;
  // Workiz asks Replace / Add only when the job already has items; an empty job takes them at once.
  const startSync = () => (jobItemCount > 0 ? setSyncing(true) : sync.mutate("replace"));
  // Server totals lag item edits by a refetch; the shared formula bridges it.
  const totals = isFetching ? localTotals : (estimate.totals ?? localTotals);
  const c = client.data;
  const clientFullName = c ? contactName(c) : "";
  const itemCost = items.reduce((sum, i) => sum + i.costCompany * i.quantity, 0);
  const margin = totals.subtotal > 0 ? Math.round(((totals.subtotal - itemCost) / totals.subtotal) * 1000) / 10 : null;
  const deposit = depositLabel({ ...estimate, totals });

  const saveHeader = (patch: Partial<EstimateHeaderValues>) => {
    const parsed = estimateHeaderSchema.partial().safeParse(patch);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid estimate details");
      return;
    }
    update.mutate(parsed.data);
  };

  // Workiz "Copy to job": the New job page, with this client and this estimate to copy onto it.
  const createJobHref = `/deals/new?contactId=${encodeURIComponent(estimate.contactId)}&then=${encodeURIComponent(`copy-estimate:${estimate.id}`)}`;

  const createJobButton =
    items.length === 0 ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="lg"
            aria-disabled="true"
            className={cn(pill, "cursor-not-allowed opacity-50")}
            onClick={(e) => e.preventDefault()}
          >
            <Briefcase /> Create new job
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add at least one item first</TooltipContent>
      </Tooltip>
    ) : (
      <Button asChild variant="outline" size="lg" className={pill}>
        <Link href={createJobHref}>
          <Briefcase /> Create new job
        </Link>
      </Button>
    );

  // Workiz's job-estimate toolbar: Price book · Sync to job · Create new job. A client's: Price book.
  const toolbar = (
    <>
      <Button asChild variant="outline" size="lg" className={pill}>
        <Link href="/inventory/items">
          <BookOpen /> Price book
        </Link>
      </Button>
      {deal ? (
        <>
          {syncBlocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="lg"
                  aria-disabled="true"
                  className={cn(pill, "cursor-not-allowed opacity-50")}
                  onClick={(e) => e.preventDefault()}
                >
                  <ArrowLeftRight /> Sync to job
                </Button>
              </TooltipTrigger>
              <TooltipContent>{syncBlocked}</TooltipContent>
            </Tooltip>
          ) : (
            <Button variant="outline" size="lg" className={pill} onClick={startSync} disabled={sync.isPending}>
              {sync.isPending ? <Loader2 className="animate-spin" /> : <ArrowLeftRight />} Sync to job
            </Button>
          )}
          {canSync ? createJobButton : null}
        </>
      ) : null}
    </>
  );

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="lg" className={pill}>
          <ChevronDown /> Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {estimate.dealId ? (
          <DropdownMenuItem asChild>
            <Link href={`/deals/${estimate.dealId}`}>
              <Wrench /> View job
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => setPreviewing(true)}>
          <Eye /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => pdf.open()} disabled={pdf.pending}>
          <Download /> Download PDF
        </DropdownMenuItem>
        {canSend ? (
          <DropdownMenuItem disabled={markSent.isPending} onSelect={() => markSent.mutate(!estimate.sentAt)}>
            {estimate.sentAt ? <Undo2 /> : <Send />} {estimate.sentAt ? "Mark as unsent" : "Mark as sent"}
          </DropdownMenuItem>
        ) : null}
        {canCreate ? (
          <DropdownMenuItem disabled={duplicate.isPending} onSelect={() => duplicate.mutate(estimate.id, { onSuccess: (e) => onOpenEstimate(e.id) })}>
            <Copy /> Duplicate
          </DropdownMenuItem>
        ) : null}
        {canSend ? (
          <DropdownMenuItem disabled={portalLink.disabled} onSelect={() => void portalLink.copy()}>
            {portalLink.pending ? <Loader2 className="animate-spin" /> : <Link2 />} Copy client portal link
          </DropdownMenuItem>
        ) : null}
        {deal && canSync ? (
          <DropdownMenuItem disabled={!!syncBlocked || sync.isPending} onSelect={startSync}>
            <ArrowLeftRight /> Sync to job
          </DropdownMenuItem>
        ) : null}
        {!deal && canSync ? (
          items.length > 0 ? (
            <DropdownMenuItem asChild>
              <Link href={createJobHref}>
                <Briefcase /> Copy to job
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled>
              <Briefcase /> Copy to job
            </DropdownMenuItem>
          )
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sendClass = "h-9 rounded-pill px-5 font-semibold";
  const sendButton = canText ? (
    onSendAll ? (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="default" size="lg" className={sendClass}>
            <Send /> Send
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setSending(true)}>
            <Send /> Send estimate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSendAll}>
            <Send /> Send all (proposal)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <Button variant="default" size="lg" className={sendClass} onClick={() => setSending(true)}>
        <Send /> Send
      </Button>
    )
  ) : canSend ? (
    <CopyPortalLinkButton contactId={estimate.contactId} />
  ) : null;

  const billTo = c?.billingAddress ?? c?.addresses?.[0];

  return (
    <div className="space-y-4">
      {deal ? (
        <>
          {/* The job's estimates (or the title), Actions ▾, Send — one row (Workiz). */}
          <div className="flex flex-wrap items-center gap-2 border-b">
            {tabs ?? (
              <div className="flex flex-wrap items-center gap-2 py-2">
                <h2 className="text-lg font-semibold">{estimateTitle(estimate)}</h2>
                <EstimateStatusBadge status={estimate.status} />
                <SentBadge sentAt={estimate.sentAt} />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2 pb-2">
              {actionsMenu}
              {sendButton}
            </div>
          </div>

          {/* Cover · Description · the grey band: client, service address, status and number. */}
          <section className="grid overflow-hidden rounded-lg border bg-card lg:grid-cols-[auto_minmax(14rem,1fr)_2fr]">
            <div className="flex items-start justify-center p-4 lg:border-r">
              <EstimateCoverField
                coverUrl={estimate.coverUrl}
                disabled={!canEdit}
                saving={update.isPending && update.variables?.coverAssetId !== undefined}
                onChange={(coverAssetId) => update.mutate({ coverAssetId })}
              />
            </div>
            <div className="min-w-0 space-y-1.5 p-4">
              <p className="text-sm font-semibold">Description</p>
              {editingDescription || !estimate.description ? (
                canEdit ? (
                  editingDescription ? (
                    <CommitTextarea
                      rows={3}
                      maxLength={2000}
                      autoFocus
                      aria-label="Description"
                      placeholder="What this option includes — the client sees it on their portal"
                      value={estimate.description ?? ""}
                      onCommit={(description) => {
                        update.mutate({ description: description || null });
                        setEditingDescription(false);
                      }}
                    />
                  ) : (
                    <button type="button" onClick={() => setEditingDescription(true)} className="text-sm font-medium text-brand hover:underline">
                      (+Add)
                    </button>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )
              ) : (
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={() => setEditingDescription(true)}
                  className="block w-full text-left text-sm whitespace-pre-line hover:underline disabled:no-underline"
                >
                  {estimate.description}
                </button>
              )}
            </div>
            <div className="grid gap-4 bg-muted/60 p-4 sm:grid-cols-3">
              <div className="space-y-0.5 text-sm">
                <p className="font-semibold">Client details</p>
                <p className="text-muted-foreground">{clientFullName || "—"}</p>
                {c?.emails?.[0] ? <p className="truncate text-muted-foreground">{c.emails[0]}</p> : null}
                {c?.phones?.[0] ? <p className="text-muted-foreground">{formatPhone(c.phones[0])}</p> : null}
              </div>
              <div className="space-y-0.5 text-sm sm:border-l sm:pl-4">
                <p className="font-semibold">Service address</p>
                {deal.address?.street ? (
                  <>
                    <p className="text-muted-foreground">{[deal.address.street, deal.address.unit].filter(Boolean).join(", ")}</p>
                    <p className="text-muted-foreground">
                      {[deal.address.city, [deal.address.state, deal.address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                    </p>
                  </>
                ) : billTo ? (
                  <p className="text-muted-foreground">{formatAddress(billTo)}</p>
                ) : (
                  <p className="text-muted-foreground">—</p>
                )}
              </div>
              <div className="space-y-2 text-sm sm:border-l sm:pl-4">
                <div className="flex items-center gap-2">
                  <label htmlFor="estimate-status" className="font-semibold">
                    Status
                  </label>
                  <EstimateStatusSelect
                    id="estimate-status"
                    className="h-8 min-w-0 flex-1"
                    value={estimate.status}
                    disabled={!canEdit || setStatus.isPending}
                    onChange={(st) => st !== estimate.status && setStatus.mutate(st)}
                  />
                </div>
                <p>
                  <span className="font-semibold">Estimate no.</span> <span className="text-muted-foreground">{estimate.number}</span>
                </p>
              </div>
            </div>
          </section>

          {/* The document's own fields — kept, in a quiet row. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        </>
      ) : (
        /* A client's estimate (Workiz): Client · Actions ▾ · Send; Bill to | Estimate, name, date, status. */
        <section aria-label="Estimate details" className="space-y-5 rounded-lg border bg-muted/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-base">
              <span>Client:</span>{" "}
              <Link href={`/contacts/${estimate.contactId}`} className="font-medium hover:underline">
                {clientFullName || "the client"}
              </Link>
            </p>
            <div className="flex items-center gap-2">
              {actionsMenu}
              {sendButton}
            </div>
          </div>
          <div className="flex flex-col gap-6 md:flex-row md:justify-between">
            <div className="space-y-1 text-sm">
              <p className="text-base font-semibold">Bill to:</p>
              {billTo ? <p>{formatAddress(billTo)}</p> : null}
              {c?.phones?.[0] ? <p>{formatPhone(c.phones[0])}</p> : null}
              {c?.emails?.[0] ? <p>{c.emails[0]}</p> : null}
              {!billTo && !c?.phones?.[0] && !c?.emails?.[0] ? <p className="text-muted-foreground">—</p> : null}
            </div>
            <dl className="grid grid-cols-[auto_minmax(12rem,17rem)] items-center gap-x-4 gap-y-2.5 text-sm">
              <dt className="font-semibold">Estimate:</dt>
              <dd className="font-mono">{estimate.number}</dd>
              <dt className="font-semibold">
                <label htmlFor="estimate-name-edit">Estimate name</label>:
              </dt>
              <dd>
                <CommitInput
                  id="estimate-name-edit"
                  value={estimate.name ?? ""}
                  placeholder="e.g. Front door"
                  maxLength={120}
                  disabled={!canEdit}
                  onCommit={(name) => saveHeader({ name: name.trim() })}
                />
              </dd>
              <dt className="font-semibold">
                <label htmlFor="estimate-date">Date</label>:
              </dt>
              <dd>
                <CommitInput
                  id="estimate-date"
                  type="date"
                  value={estimate.estimateDate}
                  disabled={!canEdit}
                  onCommit={(estimateDate) => estimateDate && saveHeader({ estimateDate })}
                />
              </dd>
              <dt className="font-semibold">
                <label htmlFor="estimate-status">Status</label>:
              </dt>
              <dd>
                <EstimateStatusSelect
                  id="estimate-status"
                  value={estimate.status}
                  disabled={!canEdit || setStatus.isPending}
                  onChange={(st) => st !== estimate.status && setStatus.mutate(st)}
                />
              </dd>
              <dt className="font-semibold">
                <label htmlFor="estimate-template">Template</label>:
              </dt>
              <dd>
                <DocumentTemplateSelect
                  id="estimate-template"
                  kind="estimate"
                  value={estimate.templateId}
                  disabled={!canEdit}
                  onChange={(templateId) => update.mutate({ templateId })}
                />
              </dd>
            </dl>
          </div>
        </section>
      )}

      {/* Items */}
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <h3 className="border-b pb-2 text-lg font-semibold">Items</h3>
        <EstimateItemsTable estimateId={estimate.id} dealId={dealId} items={items} canEdit={canEdit} toolbar={toolbar} />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-baseline gap-3 text-sm lg:pl-1">
            <span className="text-muted-foreground">Total :</span>
            <span className="font-mono text-2xl font-semibold tabular-nums">{formatMoney(totals.total)}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {items.length} item{items.length === 1 ? "" : "s"}
            </span>
          </div>
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
            extraRows={
              <>
                {itemCost > 0 ? (
                  <Row label="Item cost" value={formatMoney(itemCost)} hint={margin !== null ? `${margin}% margin` : undefined} />
                ) : null}
                <Row
                  label="Deposit"
                  value={deposit ?? "—"}
                  action={
                    canEdit ? (
                      <button type="button" onClick={() => setDepositOpen(true)} className="text-xs font-medium text-brand hover:underline">
                        {deposit ? "Change" : "Set deposit"}
                      </button>
                    ) : undefined
                  }
                />
              </>
            }
          />
        </div>
      </section>

      {/* Notes · Signatures */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2 rounded-lg border bg-card p-4">
          <h3 className="flex items-center gap-1.5 border-b pb-2 text-base font-semibold">
            <StickyNote className="size-4 text-muted-foreground" aria-hidden /> Notes
          </h3>
          <CommitTextarea
            id="estimate-notes"
            aria-label="Estimate notes"
            rows={5}
            maxLength={5000}
            placeholder="Shown on the estimate (scope, warranty, validity…)"
            value={estimate.notes ?? ""}
            disabled={!canEdit}
            onCommit={(notes) => saveHeader({ notes })}
          />
        </section>
        <div id="estimate-signatures">
          <SignaturesSection
            signatures={estimate.signatures ?? []}
            signerName={clientFullName}
            canSign={canEdit}
            saving={sign.isPending}
            onSign={(input) => sign.mutateAsync(input)}
          />
        </div>
      </div>

      {/* Keyed per opening: each opening starts from the estimate's current deposit. */}
      <SetDepositDialog
        key={depositOpen ? "open" : "closed"}
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

      <SyncToJobDialog
        open={syncing}
        onOpenChange={setSyncing}
        onContinue={(mode) => {
          setSyncing(false);
          sync.mutate(mode);
        }}
      />

      {canText ? (
        <SendDocumentDialog
          channel="email"
          open={sending}
          onOpenChange={(o) => !o && setSending(false)}
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
              onClick={() => del.mutate(estimate.id, { onSuccess: onDeleted })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
