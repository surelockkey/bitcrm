"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building, Check, ChevronDown, Pencil, ThumbsUp, Trash2, X } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { JobStatusMenu } from "@/features/job-statuses/components/job-status-menu";
import { JobTagCombobox } from "@/features/job-tags/components/job-tag-combobox";
import { useDeleteDeal, useMoveStatus, useSetDealTags, useUpdateDeal } from "../hooks";
import { isUrgent } from "../lib";
import { dealJobName, jobActions, jobNamePatch, type JobAction } from "../job-shell";
import { PriorityFlag } from "./deal-badges";
import { PILL_OUTLINE, PILL_YELLOW } from "./job-pills";

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
  invoice,
  onOpenInvoice,
}: {
  deal: Deal;
  /** The client half of the title; empty while the job has no client to name. */
  clientName: string;
  clientHref?: string;
  canEdit: boolean;
  canDelete: boolean;
  /**
   * The yellow pill: "Create Invoice" while the job has none (and the viewer
   * may make one), "View Invoice" once it exists; absent hides it.
   */
  invoice?: { exists: boolean };
  onOpenInvoice: () => void;
}) {
  const moveStatus = useMoveStatus(deal.id);
  const setTags = useSetDealTags(deal.id);
  const actions = jobActions({ superStatus: deal.superStatus, canEdit, canDelete });

  return (
    <div className="px-10 pt-5">
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
        {invoice ? (
          <button type="button" className={PILL_YELLOW} onClick={onOpenInvoice}>
            {invoice.exists ? "View Invoice" : "Create Invoice"}
          </button>
        ) : null}
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
          variant="workiz"
          value={deal.tagIds ?? []}
          onChange={(ids) => {
            const added = ids.length > (deal.tagIds?.length ?? 0);
            setTags.mutate(ids, { onSuccess: () => toast.success(added ? "Tag added" : "Tag removed") });
          }}
          disabled={!canEdit}
        />
      </HeaderRow>
    </div>
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
  delete: { label: "Delete Job", icon: Trash2 },
};

/**
 * "Actions ▾" (job_b_02_actions_open): a white 216px card under the pill,
 * one 50px row per action with its icon, ruled apart. Workiz's View Work
 * Order and Duplicate Job are not in BitCRM, so they are not listed.
 */
function ActionsMenu({ deal, actions, onDone }: { deal: Deal; actions: JobAction[]; onDone: () => void }) {
  const router = useRouter();
  const del = useDeleteDeal();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" className={PILL_OUTLINE}>
            <ChevronDown strokeWidth={1.5} />
            Actions
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          alignOffset={-12}
          sideOffset={10}
          className="w-[216px] rounded-[2px] bg-white px-2 py-1.5 shadow-[0_3px_6px_2px_rgba(0,0,0,0.18),0_4px_15px_2px_rgba(0,0,0,0.15)] ring-0"
        >
          {actions.map((a, i) => {
            const { label, icon: Icon } = ACTION_META[a];
            return (
              <DropdownMenuItem
                key={a}
                onSelect={() => (a === "done" ? onDone() : setConfirmDelete(true))}
                className={cn(
                  "h-[50px] gap-3 rounded-none px-[15px] text-[14px] text-[#566d76] focus:bg-[#f3f6f7] focus:text-[#566d76]",
                  i > 0 && "border-t border-[#cad3d6]",
                )}
              >
                <Icon className="size-5 text-[#566d76]" strokeWidth={1.25} />
                {label}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

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
