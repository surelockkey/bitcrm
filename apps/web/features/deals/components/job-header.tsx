"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building, Check, ListOrdered, Loader2, Pencil, ThumbsUp, Trash2, X } from "lucide-react";
import { JobSuperStatus, type Deal } from "@bitcrm/types";
import { toast } from "sonner";
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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { WzActionsMenu, wzPill, type WzMenuAction } from "@/components/workiz";
import { cn } from "@/lib/utils";
import { JobStatusMenu } from "@/features/job-statuses/components/job-status-menu";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { useDeleteDeal, useMoveStatus, useSetDealTags, useUpdateDeal } from "../hooks";
import { isUrgent } from "../lib";
import { dealJobName, jobActions, jobNamePatch, storedTagOrder, type JobAction, type JobInvoicePill } from "../job-shell";
import { workOrderHref } from "@/features/work-orders/lib";
import { PriorityFlag } from "./deal-badges";

/** Workiz's header ink: 18px/600 title, 13px row labels (rgb 59,76,83 ≈ the ink token). */
const LABEL = "w-auto shrink-0 text-[13px] leading-[19.5px] text-foreground";

/**
 * The top of the job page as Workiz lays it out (job_b_01_details): the
 * title "Job #5TU7ZA - Dustin Roselle" with Actions ▾ and Create Invoice on
 * the right, then "Job name:", "Status:" and "Tags:" rows on the grey band.
 */
export function JobHeader({
  deal,
  clientName,
  clientHref,
  canEdit,
  canDelete,
  canViewWorkOrders = false,
  invoice,
  invoicePending = false,
  onInvoice,
}: {
  deal: Deal;
  /** The client half of the title; empty while the job has no client to name. */
  clientName: string;
  clientHref?: string;
  canEdit: boolean;
  canDelete: boolean;
  /** `work_orders.view` — "View Work Order" for a job a work order authorized. */
  canViewWorkOrders?: boolean;
  /**
   * The yellow pill (`jobInvoicePill`): "View Invoice" once the job has one,
   * "Create Invoice" while it has none (greyed, with the reason, while it
   * cannot be made yet); absent hides it.
   */
  invoice?: JobInvoicePill | null;
  /** The invoice is being made. */
  invoicePending?: boolean;
  /** View → open its page; Create → make it, then open its page. */
  onInvoice: () => void;
}) {
  const moveStatus = useMoveStatus(deal.id);
  const setTags = useSetDealTags(deal.id);
  const actions = jobActions({
    superStatus: deal.superStatus,
    canEdit,
    canDelete,
    workOrderId: deal.workOrderId,
    canViewWorkOrders,
  });

  return (
    <div className="px-4 pt-5 md:px-10">
      <div className="flex min-h-[34px] flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[18px] leading-[27px] font-semibold text-foreground">
          Job <span>#{deal.dealNumber}</span>
          {clientName ? (
            <>
              {" - "}
              {clientHref ? (
                <Link href={clientHref} className="hover:underline">
                  {clientName}
                </Link>
              ) : (
                clientName
              )}
            </>
          ) : null}
        </h1>
        {isUrgent(deal) ? <PriorityFlag /> : null}
        {deal.businessProfileName ? (
          // Not on Workiz's header (it has one company): ours names the brand
          // the job is done under, quietly, beside the title.
          <span title="Company" className="inline-flex items-center gap-1 text-[13px] text-foreground/80">
            <Building className="size-3.5" />
            {deal.businessProfileName}
          </span>
        ) : null}
        <span className="flex-1" />
        {actions.length > 0 ? (
          <ActionsMenu
            deal={deal}
            actions={actions}
            onDone={() =>
              moveStatus.mutate(
                { superStatus: JobSuperStatus.DONE },
                { onSuccess: () => toast.success("Status updated") },
              )
            }
          />
        ) : null}
        {invoice ? <InvoicePill pill={invoice} pending={invoicePending} onClick={onInvoice} /> : null}
      </div>

      <HeaderRow label="Job name:" className="mt-6 min-h-6">
        <JobNameField deal={deal} canEdit={canEdit} />
      </HeaderRow>

      <HeaderRow label="Status:" className="mt-5 min-h-[27px]">
        <JobStatusMenu
          value={{ superStatus: deal.superStatus, subStatusId: deal.subStatusId }}
          onChange={(v) => moveStatus.mutate(v, { onSuccess: () => toast.success("Status updated") })}
          disabled={!canEdit}
        />
      </HeaderRow>

      <HeaderRow label="Tags:" className="mt-[17px] min-h-6">
        <JobTagCombobox
          // The workiz dress prints them in catalog order, as Workiz's header does.
          variant="workiz"
          value={deal.tagIds ?? []}
          onChange={(ids) => {
            const added = ids.length > (deal.tagIds?.length ?? 0);
            setTags.mutate(storedTagOrder(deal.tagIds ?? [], ids), {
              onSuccess: () => toast.success(added ? "Tag added" : "Tag removed"),
            });
          }}
          disabled={!canEdit}
        />
      </HeaderRow>
    </div>
  );
}

/**
 * Workiz's yellow "View Invoice" / "Create Invoice" (data-ai-id view-invoice /
 * create-invoice): both lead to the invoice's own page. A job that cannot be
 * invoiced yet keeps the pill, greyed, its reason in a tooltip (and for a
 * screen reader in its description).
 */
function InvoicePill({ pill, pending, onClick }: { pill: JobInvoicePill; pending: boolean; onClick: () => void }) {
  const label = pill.action === "view" ? "View Invoice" : "Create Invoice";
  const blocked = pill.action === "create" ? pill.blockedReason : undefined;
  if (blocked) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* aria-disabled keeps it focusable, so the tooltip can say why. */}
            <button
              type="button"
              aria-disabled="true"
              aria-describedby="job-invoice-blocked"
              className={cn(wzPill("yellow"), "cursor-not-allowed opacity-50 hover:bg-primary")}
              onClick={(e) => e.preventDefault()}
            >
              {label}
            </button>
          </TooltipTrigger>
          <TooltipContent>{blocked}</TooltipContent>
        </Tooltip>
        <span id="job-invoice-blocked" className="sr-only">
          {blocked}
        </span>
      </TooltipProvider>
    );
  }
  return (
    <button type="button" className={wzPill("yellow")} onClick={onClick} disabled={pending} aria-busy={pending || undefined}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {label}
    </button>
  );
}

function HeaderRow({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

/* --------------------------------------------------------------- job name */

/**
 * "Job name: ✎" — the name (when the job has one) and a blue pencil that
 * turns the line into a box. Enter or ✓ saves, Esc or × backs out; emptying
 * the box clears the name.
 */
function JobNameField({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const name = dealJobName(deal);
  const [draft, setDraft] = useState<string | null>(null);

  const save = () => {
    if (draft === null) return;
    const patch = jobNamePatch(name, draft);
    setDraft(null);
    if (patch) update.mutate(patch);
  };

  if (draft !== null) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          aria-label="Job name"
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setDraft(null);
          }}
          className="h-7 w-64 rounded-[4px] border border-[#9ea6aa] bg-white px-2 text-[13px] text-foreground outline-none focus:border-[#6aa8ee]"
        />
        <button type="button" aria-label="Save job name" onClick={save} className="grid size-6 place-items-center rounded-[4px] text-[#6aa8ee] hover:bg-accent">
          <Check className="size-4" />
        </button>
        <button type="button" aria-label="Cancel" onClick={() => setDraft(null)} className="grid size-6 place-items-center rounded-[4px] text-foreground hover:bg-accent">
          <X className="size-4" />
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {name ? <span className="truncate text-[13px] leading-[19.5px] text-foreground">{name}</span> : null}
      {canEdit ? (
        <button
          type="button"
          aria-label="Edit job name"
          title="Edit job name"
          onClick={() => setDraft(name)}
          // Workiz's 24px icon button, its pencil in the link blue.
          className="grid size-6 place-items-center rounded-[4px] text-[#6aa8ee] hover:bg-accent"
        >
          <Pencil className="size-3.5" strokeWidth={1.5} />
        </button>
      ) : null}
    </span>
  );
}

/* ----------------------------------------------------------- Actions menu */

const ACTION_META: Record<JobAction, { label: string; icon: typeof ThumbsUp }> = {
  done: { label: "Job Done", icon: ThumbsUp },
  // Workiz's `lnr-numbers`.
  work_order: { label: "View Work Order", icon: ListOrdered },
  delete: { label: "Delete Job", icon: Trash2 },
};

/**
 * "Actions ▾" (job_b_02_actions_open): the kit's `WzActionsMenu` — the white
 * 216px card under the pill with its caret, one 50px row per action with
 * its icon, ruled apart. View Work Order opens the work order that
 * authorized the job; Workiz's Duplicate Job is not in BitCRM, so it is not
 * listed. Delete Job stays slate like the rest, as Workiz keeps it.
 */
function ActionsMenu({ deal, actions, onDone }: { deal: Deal; actions: JobAction[]; onDone: () => void }) {
  const router = useRouter();
  const del = useDeleteDeal();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const items: WzMenuAction[] = actions.map((a) => ({
    key: a,
    label: ACTION_META[a].label,
    icon: ACTION_META[a].icon,
    onSelect: () => {
      if (a === "done") onDone();
      else if (a === "work_order") router.push(workOrderHref(deal.workOrderId as string));
      else setConfirmDelete(true);
    },
  }));

  return (
    <>
      <WzActionsMenu items={items} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job #{deal.dealNumber}?</AlertDialogTitle>
            <AlertDialogDescription>This soft-deletes the job — it&apos;s archived and drops out of the pipeline.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                del.mutate(deal.id, { onSuccess: () => router.push("/deals") });
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
