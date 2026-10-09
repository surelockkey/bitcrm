"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Popover } from "radix-ui";
import {
  ArrowLeftRight,
  BookOpen,
  Briefcase,
  ChevronDown,
  Copy,
  CopyPlus,
  Download,
  Eye,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Send,
  SquarePen,
  Trash2,
  Undo2,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
import { WzButton, WzButtonLink } from "@/components/workiz/button";
import { WzDayPicker } from "@/components/workiz/day-picker";
import { WzDocSectionHead, WzTotalsBoxRow } from "@/components/workiz/document-parts";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { SyncToJobDialog } from "./sync-to-job-dialog";
import { formatWzDocDate, todayYmd } from "@/features/billing/dates";
import { formatBoxAmount } from "@/features/billing/lib";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitInput, CommitTextarea } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { SignaturesSection } from "@/features/billing/components/signatures-section";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { useDocumentSettings, useUpdateDocumentSettings } from "@/features/documents/hooks";
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
import { SetDepositDialog, depositBoxText } from "./set-deposit-dialog";

/*
 * 2026-10-09: back to Workiz (pg_estimate_wz_01_job / _02_client). The
 * 2026-10-05 look the owner had asked for ("зроби інакшими по дизайну":
 * square buttons, a segmented strip, Notes · Signatures as one card) gave way
 * to the 2026-10-08 rule that the whole app is Workiz. Only the dress changed;
 * every hook, permission and handler below is as it was — to go back, restore
 * this file's JSX from 38c370bd/5ec9daa0 and drop the `variant="workiz"`s.
 */

/** The band's grey columns (headerJob-module): titles #3b4c53, words rgba(59,76,83,.6), 13px/24px 500. */
const BAND_TITLE = "text-[13px] leading-6 font-medium text-[#3b4c53]";
const BAND_TEXT = "truncate text-[13px] leading-6 font-medium text-[rgba(59,76,83,0.6)]";
/** The client header's labels (headerStub-module h4): 16px/35px 600 #404040. */
const STUB_LABEL = "shrink-0 text-[16px] leading-[35px] font-semibold text-wz-strong";

/**
 * One estimate, laid out as Workiz lays its estimate page out. Two layouts,
 * as there:
 * - a JOB's estimate (`deal` given): the job's estimates as tabs with
 *   Actions ▾ and the yellow Send; a band with the cover image, the
 *   description, the client's details, the service address, the status and
 *   the estimate's number (and ours: its date and template); Items with
 *   Add item / Price book / Sync to job / Create new job;
 * - a CLIENT's estimate (no job): a grey header with "Client: …", Actions ▾
 *   and Send, "Bill to:" on the left and Estimate / Estimate name / Date /
 *   Status (and ours: Template) on the right; Items with Add item / Price
 *   book, and Actions → Copy to job.
 * Then the totals, Notes and Signatures, the same for both.
 */
export function EstimateEditor({
  estimateId,
  deal,
  jobItemCount: jobItems,
  tabs,
  onOpenEstimate,
  onDeleted,
  onSendAll,
}: {
  estimateId: string;
  deal?: Deal;
  /**
   * How many items the job has now (the page holds the job's items) — Sync
   * asks Replace / Add only when there are some. The job's own count stands
   * in when it is not given.
   */
  jobItemCount?: number;
  /**
   * The job's estimate tabs, rendered left of Actions / Send (Workiz). Absent
   * on a page of its own. A function is handed the rename (Workiz renames an
   * estimate in its tab) when the reader may edit.
   */
  tabs?: ReactNode | ((rename: ((name: string) => void) | undefined) => ReactNode);
  onOpenEstimate: (id: string) => void;
  /** Where to go once the estimate is deleted. */
  onDeleted?: () => void;
  /** Workiz "Send > Send all (proposal)": given when the job has open estimates to send together. */
  onSendAll?: () => void;
}) {
  const { can } = usePermissions();
  const dealId = deal?.id;
  const { data: estimate, isLoading, isError, error, isFetching } = useEstimate(estimateId);
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
  const [editingNotes, setEditingNotes] = useState(false);
  const client = useContact(estimate?.contactId ?? "");
  // Loaded once for the Send panel's defaults; the deposit dialog writes it.
  useDocumentSettings();

  const items = useMemo(() => estimate?.items ?? [], [estimate?.items]);
  const localTotals = useMemo(() => (estimate ? estimateLocalTotals(estimate, items) : null), [estimate, items]);

  if (isLoading) {
    return (
      <div className="space-y-3 px-5">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !estimate || !localTotals) {
    return (
      <div className="mx-5 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
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
  const canSeeCost = can("financials", "view");
  const syncBlocked = syncBlockReason(estimate, items.length, canSync, !!deal);
  const jobItemCount = jobItems ?? deal?.itemCount ?? 0;
  // Workiz asks Replace / Add only when the job already has items; an empty job takes them at once.
  const startSync = () => (jobItemCount > 0 ? setSyncing(true) : sync.mutate("replace"));
  // Server totals lag item edits by a refetch; the shared formula bridges it.
  const totals = isFetching ? localTotals : (estimate.totals ?? localTotals);
  const c = client.data;
  const clientFullName = c ? contactName(c) : "";
  const itemCost = items.reduce((sum, i) => sum + i.costCompany * i.quantity, 0);
  const margin = totals.subtotal > 0 ? Math.round(((totals.subtotal - itemCost) / totals.subtotal) * 1000) / 10 : null;

  const saveHeader = (patch: Partial<EstimateHeaderValues>) => {
    const parsed = estimateHeaderSchema.partial().safeParse(patch);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid estimate details");
      return;
    }
    update.mutate(parsed.data);
  };
  const rename = canEdit ? (name: string) => saveHeader({ name: name.trim() }) : undefined;

  // Workiz "Copy to job": the New job page, with this client and this estimate to copy onto it.
  const createJobHref = `/deals/new?contactId=${encodeURIComponent(estimate.contactId)}&then=${encodeURIComponent(`copy-estimate:${estimate.id}`)}`;

  // A button that cannot act yet says why on hover (Workiz has these always on).
  const blocked = "cursor-not-allowed opacity-50 hover:bg-transparent";
  const createJobButton =
    items.length === 0 ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <WzButton
            variant="secondary"
            size="regular"
            icon={<Briefcase strokeWidth={1.5} />}
            aria-disabled="true"
            className={blocked}
            onClick={(e) => e.preventDefault()}
          >
            Create new job
          </WzButton>
        </TooltipTrigger>
        <TooltipContent>Add at least one item first</TooltipContent>
      </Tooltip>
    ) : (
      <WzButtonLink href={createJobHref} variant="secondary" size="regular" icon={<Briefcase strokeWidth={1.5} />}>
        Create new job
      </WzButtonLink>
    );

  // Workiz's job-estimate buttons under the items: Price book · Sync to job · Create new job. A client's: Price book.
  const toolbar = (
    <>
      <WzButtonLink href="/inventory/items" variant="secondary" size="regular" icon={<BookOpen strokeWidth={1.5} />}>
        Price book
      </WzButtonLink>
      {deal ? (
        <>
          {syncBlocked ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <WzButton
                  variant="secondary"
                  size="regular"
                  icon={<RefreshCw strokeWidth={1.5} />}
                  aria-disabled="true"
                  className={blocked}
                  onClick={(e) => e.preventDefault()}
                >
                  Sync to job
                </WzButton>
              </TooltipTrigger>
              <TooltipContent>{syncBlocked}</TooltipContent>
            </Tooltip>
          ) : (
            <WzButton
              variant="secondary"
              size="regular"
              icon={sync.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw strokeWidth={1.5} />}
              onClick={startSync}
              disabled={sync.isPending}
            >
              Sync to job
            </WzButton>
          )}
          {canSync ? createJobButton : null}
        </>
      ) : null}
    </>
  );

  // Workiz's MenuPopup: its rows in its order, ours (sent, duplicate, portal link, sync) before Delete.
  const actionsMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <WzButton variant="secondary" size="regular" icon={<ChevronDown strokeWidth={1.5} />} className="aria-expanded:bg-wz-secondary-hover">
          Actions
        </WzButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4} className={WZ_MENU_POPUP}>
        {estimate.dealId ? (
          <DropdownMenuItem asChild className={WZ_MENU_POPUP_ITEM}>
            <Link href={`/deals/${estimate.dealId}`}>
              <Wrench strokeWidth={1.25} /> View job
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => setPreviewing(true)}>
          <Eye strokeWidth={1.25} /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => pdf.open()} disabled={pdf.pending}>
          <Download strokeWidth={1.25} /> Download
        </DropdownMenuItem>
        {canSend ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={markSent.isPending} onSelect={() => markSent.mutate(!estimate.sentAt)}>
            {estimate.sentAt ? <Undo2 strokeWidth={1.25} /> : <Send strokeWidth={1.25} />}{" "}
            {estimate.sentAt ? "Mark as unsent" : "Mark as sent"}
          </DropdownMenuItem>
        ) : null}
        {canCreate ? (
          <DropdownMenuItem
            className={WZ_MENU_POPUP_ITEM}
            disabled={duplicate.isPending}
            onSelect={() => duplicate.mutate(estimate.id, { onSuccess: (e) => onOpenEstimate(e.id) })}
          >
            <CopyPlus strokeWidth={1.25} /> Duplicate
          </DropdownMenuItem>
        ) : null}
        {canSend ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={portalLink.disabled} onSelect={() => void portalLink.copy()}>
            {portalLink.pending ? <Loader2 className="animate-spin" /> : <Link2 strokeWidth={1.25} />} Copy client portal link
          </DropdownMenuItem>
        ) : null}
        {deal && canSync ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={!!syncBlocked || sync.isPending} onSelect={startSync}>
            <ArrowLeftRight strokeWidth={1.25} /> Sync to job
          </DropdownMenuItem>
        ) : null}
        {!deal && canSync ? (
          items.length > 0 ? (
            <DropdownMenuItem asChild className={WZ_MENU_POPUP_ITEM}>
              <Link href={createJobHref}>
                <Copy strokeWidth={1.25} /> Copy to job
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled>
              <Copy strokeWidth={1.25} /> Copy to job
            </DropdownMenuItem>
          )
        ) : null}
        {canDelete ? (
          <DropdownMenuItem variant="destructive" className={WZ_MENU_POPUP_ITEM} onSelect={() => setDeleting(true)}>
            <Trash2 strokeWidth={1.25} /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const sendButton = canText ? (
    onSendAll ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <WzButton size="regular" icon={<Send strokeWidth={1.5} />}>
            Send
          </WzButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4} className={WZ_MENU_POPUP}>
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => setSending(true)}>
            <Send strokeWidth={1.25} /> Send estimate
          </DropdownMenuItem>
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={onSendAll}>
            <Send strokeWidth={1.25} /> Send all (proposal)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <WzButton size="regular" icon={<Send strokeWidth={1.5} />} onClick={() => setSending(true)}>
        Send
      </WzButton>
    )
  ) : canSend ? (
    <CopyPortalLinkButton contactId={estimate.contactId} className="h-8" />
  ) : null;

  const billTo = c?.billingAddress ?? c?.addresses?.[0];
  const dateField = (
    <EstimateDateField
      id="estimate-date"
      value={estimate.estimateDate}
      disabled={!canEdit}
      onChange={(estimateDate) => estimateDate !== estimate.estimateDate && saveHeader({ estimateDate })}
      className={deal ? "text-[13px] leading-6 font-medium text-[rgba(59,76,83,0.6)]" : "h-[34px] px-2.5 text-[16px] leading-[30px] text-wz-text"}
    />
  );
  const templateSelect = (
    <DocumentTemplateSelect
      id="estimate-template"
      kind="estimate"
      value={estimate.templateId}
      disabled={!canEdit}
      onChange={(templateId) => update.mutate({ templateId })}
      className={cn(
        "w-auto max-w-[180px] gap-1.5 rounded-none border-0 bg-transparent p-0 shadow-none hover:border-0 disabled:bg-transparent data-[size=sm]:pl-0 data-[state=open]:shadow-none [&>svg]:size-3.5! [&>svg]:text-wz-caption!",
        deal
          ? "h-6 text-[13px] font-medium text-[rgba(59,76,83,0.6)] data-[size=sm]:h-6 disabled:text-[rgba(59,76,83,0.6)]"
          : "h-[35px] text-[16px] text-wz-text data-[size=sm]:h-[35px] disabled:text-wz-text",
      )}
    />
  );

  const tabsNode = typeof tabs === "function" ? tabs(rename) : tabs;

  return (
    <div className="pb-10 text-wz-strong">
      {deal ? (
        <>
          {/* The job's estimates (or the title), Actions ▾, Send — one row, bottoms level (estimatesHeader rowWrap). */}
          <div className="flex items-end justify-between gap-3 pr-5">
            {tabsNode ?? (
              <div className="flex flex-wrap items-center gap-2 pb-1 pl-5">
                <h2 className="text-[16px] leading-[25px] font-medium">{estimateTitle(estimate)}</h2>
                <EstimateStatusBadge status={estimate.status} />
              </div>
            )}
            <div className="flex shrink-0 items-center gap-3 pb-[15px]">
              {actionsMenu}
              {sendButton}
            </div>
          </div>

          {/* The band (headerJob-module): cover · description on white, then client, service address, status and number on grey. */}
          <section
            aria-label="Estimate details"
            className="flex min-h-[155px] overflow-x-auto border border-[#dfe2e3] bg-wz-tile"
          >
            <div className="flex min-h-[153px] w-[459px] shrink-0 items-center bg-white">
              <div className="mx-12 shrink-0">
                <EstimateCoverField
                  coverUrl={estimate.coverUrl}
                  disabled={!canEdit}
                  saving={update.isPending && update.variables?.coverAssetId !== undefined}
                  onChange={(coverAssetId) => update.mutate({ coverAssetId })}
                />
              </div>
              <div className="relative mr-10 ml-[34px] h-[104px] w-[188px] shrink-0">
                <p className={BAND_TITLE}>Description</p>
                {estimate.description ? (
                  <>
                    <p className="line-clamp-2 text-[13px] leading-5 font-medium break-words whitespace-pre-wrap text-[rgba(59,76,83,0.6)]">
                      {estimate.description}
                    </p>
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label="Edit description"
                        onClick={() => setEditingDescription(true)}
                        className="mt-2.5 text-[13px] leading-4 font-medium text-wz-link hover:underline"
                      >
                        Edit
                      </button>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* Workiz's empty description: three pale bars. */}
                    <span aria-hidden className="mt-4 mr-2 block h-2 rounded-[8px] bg-[#ecedee]" />
                    <span aria-hidden className="mt-4 mr-2 block h-2 rounded-[8px] bg-[#ecedee]" />
                    <span aria-hidden className="mt-4 mr-2 block h-2 w-[65%] rounded-[8px] bg-[#ecedee]" />
                    {canEdit ? (
                      <button
                        type="button"
                        aria-label="Add description"
                        onClick={() => setEditingDescription(true)}
                        className="absolute right-[5%] bottom-0 text-[13px] leading-4 font-medium text-wz-link hover:underline"
                      >
                        (+Add)
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>
            <div className="mx-10 my-[22px] w-[186px] shrink-0">
              <p className={BAND_TITLE}>Client details</p>
              <p className={BAND_TEXT}>{clientFullName || "—"}</p>
              {c?.emails?.[0] ? <p className={BAND_TEXT}>{c.emails[0]}</p> : null}
              {c?.phones?.[0] ? <p className={BAND_TEXT}>{formatPhone(c.phones[0])}</p> : null}
            </div>
            <span aria-hidden className="h-[110px] w-px shrink-0 self-center bg-wz-rule" />
            <div className="mx-[29px] my-[22px] w-[186px] shrink-0">
              <p className={BAND_TITLE}>Service address</p>
              {deal.address?.street ? (
                <>
                  <p className={BAND_TEXT}>{[deal.address.street, deal.address.unit].filter(Boolean).join(", ")}</p>
                  <p className="line-clamp-2 text-[13px] leading-6 font-medium text-[rgba(59,76,83,0.6)]">
                    {[deal.address.city, [deal.address.state, deal.address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                  </p>
                </>
              ) : billTo ? (
                <p className="line-clamp-3 text-[13px] leading-6 font-medium text-[rgba(59,76,83,0.6)]">
                  {[billTo.street, billTo.unit].filter(Boolean).join(", ")}
                  <br />
                  {[billTo.city, [billTo.state, billTo.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}
                </p>
              ) : (
                <p className={BAND_TEXT}>—</p>
              )}
            </div>
            <span aria-hidden className="h-[110px] w-px shrink-0 self-center bg-wz-rule" />
            {/* 22px in from the top like Workiz's; our Date and Template rows take the room it leaves under the number. */}
            <div className="shrink-0 px-10 pt-[22px] pb-1">
              <div className="mb-2.5 flex h-11 w-[186px] items-start gap-2.5 border-b border-[#ecedee]">
                <label htmlFor="estimate-status" className="pt-[7px] text-[14px] leading-6 font-medium">
                  Status
                </label>
                <div className="pt-1.5">
                  <EstimateStatusSelect
                    id="estimate-status"
                    className="w-[150px]"
                    value={estimate.status}
                    disabled={!canEdit || setStatus.isPending}
                    onChange={(st) => st !== estimate.status && setStatus.mutate(st)}
                  />
                </div>
              </div>
              <p className="flex text-[13px] leading-6 font-medium">
                <span>Estimate no.</span>
                <span className="text-[rgba(59,76,83,0.6)]">{estimate.number}</span>
              </p>
              {/* Ours, where Workiz keeps the estimate's facts: its day and its print template. */}
              <div className="flex items-center gap-1 text-[13px] leading-6 font-medium">
                <label htmlFor="estimate-date">Date</label>
                {dateField}
              </div>
              <div className="flex items-center gap-1 text-[13px] leading-6 font-medium">
                <label htmlFor="estimate-template">Template</label>
                {templateSelect}
              </div>
            </div>
          </section>
        </>
      ) : (
        /* A client's estimate (headerStub-module): Client · Actions ▾ · Send; Bill to | Estimate, name, date, status. */
        <section aria-label="Estimate details" className="relative bg-wz-tile px-5 pt-[53px] pb-7">
          <div className="absolute top-[30px] right-5 flex items-center gap-3">
            {actionsMenu}
            {sendButton}
          </div>
          <p className="truncate text-[16px] leading-[19px]">
            <span>Client:</span>{" "}
            <Link href={`/contacts/${estimate.contactId}`} className="text-foreground hover:underline">
              {clientFullName || "the client"}
            </Link>
          </p>
          <div className="mt-[22px] flex flex-col gap-6 md:flex-row md:justify-between">
            <div className="md:w-1/3">
              <p className="my-2 text-[18px] leading-[19px] font-semibold text-[#3b4c53]">Bill to:</p>
              <div className="text-[14px] leading-[22px]">
                {billTo ? (
                  <>
                    <p>{[billTo.street, billTo.unit].filter(Boolean).join(", ")}</p>
                    <p>{[billTo.city, [billTo.state, billTo.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</p>
                  </>
                ) : null}
                {c?.phones?.[0] ? <p>{formatPhone(c.phones[0])}</p> : null}
                {c?.emails?.[0] ? <p>{c.emails[0]}</p> : null}
                {!billTo && !c?.phones?.[0] && !c?.emails?.[0] ? <p>—</p> : null}
              </div>
            </div>
            <dl className="md:w-1/3">
              <div className="flex items-center gap-2.5">
                <dt className={STUB_LABEL}>Estimate:</dt>
                <dd className="text-[15px] leading-4">{estimate.number}</dd>
              </div>
              <div className="flex items-center gap-1">
                <dt className={STUB_LABEL}>
                  <label htmlFor="estimate-name-edit">Estimate name</label>:
                </dt>
                <dd className="relative ml-1.5 flex items-center">
                  <CommitInput
                    id="estimate-name-edit"
                    value={estimate.name ?? ""}
                    maxLength={120}
                    disabled={!canEdit}
                    onCommit={(name) => saveHeader({ name: name.trim() })}
                    className="h-[35px] w-[140px] rounded-[4px] border-transparent bg-transparent px-1.5 pr-7 text-[15px] text-wz-strong shadow-none hover:border-transparent hover:bg-wz-secondary-hover focus-visible:border-wz-focus focus-visible:bg-white disabled:pointer-events-auto disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:text-wz-strong md:text-[15px]"
                  />
                  {canEdit ? <Pencil aria-hidden className="pointer-events-none absolute right-2 size-3.5 text-foreground" strokeWidth={1.5} /> : null}
                </dd>
              </div>
              <div className="flex items-center gap-2.5">
                <dt className={STUB_LABEL}>
                  <label htmlFor="estimate-date">Date</label>:
                </dt>
                <dd>{dateField}</dd>
              </div>
              <div className="flex items-center gap-2.5">
                <dt className={STUB_LABEL}>
                  <label htmlFor="estimate-status">Status</label>:
                </dt>
                {/* react-select's value sits 11px into its box (pg_estimate_wz_02_client: the dot at x=1211). */}
                <dd className="ml-[11px] w-[150px]">
                  <EstimateStatusSelect
                    id="estimate-status"
                    size="header"
                    value={estimate.status}
                    disabled={!canEdit || setStatus.isPending}
                    onChange={(st) => st !== estimate.status && setStatus.mutate(st)}
                  />
                </dd>
              </div>
              <div className="flex items-center gap-2.5">
                <dt className={STUB_LABEL}>
                  <label htmlFor="estimate-template">Template</label>:
                </dt>
                <dd>{templateSelect}</dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      <div className="px-5">
        {/* Items (items-module): the 62px title over a #ccc rule, the grid, the buttons. */}
        <section aria-labelledby="estimate-items-heading" className="pt-5">
          <div className="h-[62px] border-b border-input pt-[17px]">
            <h3 id="estimate-items-heading" className="text-[16px] leading-[19px] font-semibold">
              Items
            </h3>
          </div>
          <EstimateItemsTable
            variant="workiz"
            estimateId={estimate.id}
            dealId={dealId}
            items={items}
            canEdit={canEdit}
            toolbar={toolbar}
          />
        </section>

        {/* Totals (totals-module): Total on the left; Subtotal … Tax, Item cost, Deposit on the right. */}
        <DocumentSummaryPanel
          variant="workiz"
          className="mt-[62px]"
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
              {canSeeCost ? (
                <WzTotalsBoxRow label="Item cost" title={margin !== null ? `${margin}% margin` : undefined}>
                  {formatBoxAmount(itemCost)}
                </WzTotalsBoxRow>
              ) : null}
              <WzTotalsBoxRow
                label="Deposit"
                underline
                onClick={canEdit ? () => setDepositOpen(true) : undefined}
                title={canEdit ? "Set deposit" : undefined}
              >
                {depositBoxText({ ...estimate, totals })}
              </WzTotalsBoxRow>
            </>
          }
        />

        {/* Notes | Signatures — Workiz's two columns, 40px apart. */}
        <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
          <section aria-label="Notes" className="min-w-0">
            <WzDocSectionHead title="Notes" icon={<SquarePen strokeWidth={1.25} />} className="border-input pb-[15px]" />
            <div className="mt-5">
              {editingNotes ? (
                <CommitTextarea
                  id="estimate-notes"
                  aria-label="Estimate notes"
                  autoFocus
                  rows={4}
                  maxLength={5000}
                  placeholder="Shown on the estimate (scope, warranty, validity…)"
                  value={estimate.notes ?? ""}
                  onBlurCapture={() => setEditingNotes(false)}
                  onCommit={(notes) => saveHeader({ notes })}
                  className="text-[14px] leading-4"
                />
              ) : (
                <>
                  {estimate.notes ? <p className="text-[14px] leading-4 break-words whitespace-pre-line">{estimate.notes}</p> : null}
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditingNotes(true)}
                      className={cn("text-[13px] leading-4 font-medium text-wz-link hover:underline", estimate.notes && "mt-2.5")}
                    >
                      {estimate.notes ? "(Edit)" : "(+Add)"}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </section>
          <div id="estimate-signatures" className="min-w-0">
            <SignaturesSection
              variant="workiz"
              signatures={estimate.signatures ?? []}
              signerName={clientFullName}
              canSign={canEdit}
              saving={sign.isPending}
              onSign={(input) => sign.mutateAsync(input)}
            />
          </div>
        </div>
      </div>

      {/* Workiz edits the description in a small window (headerJob-module__descriptionModal). */}
      {editingDescription ? (
        <DescriptionDialog
          value={estimate.description ?? ""}
          saving={update.isPending}
          onCancel={() => setEditingDescription(false)}
          onSave={(description) =>
            update.mutate({ description: description || null }, { onSuccess: () => setEditingDescription(false) })
          }
        />
      ) : null}

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

/**
 * The estimate's day as Workiz prints it ("Thu Jun 18 2026", underlined),
 * opening react-datepicker's month under it; a pick saves at once.
 */
function EstimateDateField({
  id,
  value,
  disabled,
  onChange,
  className,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (day: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const text = formatWzDocDate(value) || "—";
  if (disabled) {
    return (
      <span id={id} className={cn("underline", className)}>
        {text}
      </span>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          className={cn("rounded-[2px] text-left underline outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus", className)}
        >
          {text}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={10} className="z-50 outline-none">
          <WzDayPicker
            value={value}
            today={todayYmd()}
            onSelect={(day) => {
              setOpen(false);
              onChange(day);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Workiz's description window: a 150px box and Save. */
function DescriptionDialog({
  value,
  saving,
  onCancel,
  onSave,
}: {
  value: string;
  saving: boolean;
  onCancel: () => void;
  onSave: (description: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Description</DialogTitle>
        </DialogHeader>
        <Textarea
          aria-label="Description"
          autoFocus
          maxLength={2000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What this option includes — the client sees it on their portal"
          className="h-[150px] resize-none"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="brand" onClick={() => onSave(draft.trim())} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
