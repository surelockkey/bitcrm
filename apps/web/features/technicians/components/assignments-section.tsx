"use client";

import { useState } from "react";
import { Check, ChevronDown, Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { WzFormSectionTitle } from "@/components/workiz/form-section-title";
import { cn } from "@/lib/utils";
import type { TechnicianJobType, TechnicianServiceArea, AssignmentStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useAssignments,
  useApproveAssignment,
  useRejectAssignment,
  useRevokeAssignment,
  useProposeAssignments,
  useAssignDirect,
} from "../hooks";
import type { AssignmentKind } from "../api";
import { ServiceAreaPicker } from "@/features/service-areas/components/service-area-picker";
import { JobTypePicker } from "@/features/job-types/components/job-type-picker";
import { useJobTypeName } from "@/features/job-types/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";

/**
 * A row of the assignments list, normalised across the two kinds so the chip
 * and its controls don't care whether it's a job type or a service area.
 */
interface Row {
  kind: AssignmentKind;
  catalogId: string;
  name: string;
  status: AssignmentStatus;
  comments?: string;
}

/**
 * Workiz's words for each catalog (pg_technicians_wz_10_user_profile): the
 * block's title, the label in the box's notch — job types are Workiz's
 * "User skills" — and what the chevron does here.
 */
const COPY: Record<AssignmentKind, { title: string; box: string; empty: string; assign: string; propose: string }> = {
  job_type: {
    title: "Job types",
    box: "User skills",
    empty: "No job types yet.",
    assign: "Assign job types",
    propose: "Propose job types",
  },
  service_area: {
    title: "Service areas",
    box: "Service areas",
    empty: "No service areas yet.",
    assign: "Assign service areas",
    propose: "Propose service areas",
  },
};

export const ASSIGNMENT_TITLES: Record<AssignmentKind, string> = {
  job_type: COPY.job_type.title,
  service_area: COPY.service_area.title,
};

/**
 * One catalog's assignments as Workiz draws "User skills" / "Service areas" on
 * the user page: a 480px box with its label in the notch (11px ink), the
 * entries as chips inside — #f3f6f7, 2px corners, 12px/500 #566d76 words
 * 3px 3px 3px 6px, a 26px × — and a chevron at the right that adds more.
 *
 * Ours on top of Workiz's: an entry has a review state. A proposed one (amber)
 * carries ✓ / × for whoever may approve; a rejected one is red with the reason
 * on hover; an approved one is the plain Workiz chip, its × a revoke for
 * whoever may revoke. The chevron opens the manager's direct grant, or for a
 * technician on their own card, the proposal. Each instance owns its dialogs.
 */
export function AssignmentsSection({ technicianId, kind }: { technicianId: string; kind: AssignmentKind }) {
  const { me, can } = usePermissions();
  const { data, isLoading } = useAssignments(technicianId);
  const jobTypeName = useJobTypeName();
  const { data: areas } = useServiceAreas();

  const approve = useApproveAssignment();
  const revoke = useRevokeAssignment();

  const [rejectTarget, setRejectTarget] = useState<Row | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);

  const resource = kind === "job_type" ? "job_types" : "service_areas";
  const canApprove = can(resource, "approve");
  const canRevoke = can(resource, "revoke");
  const canPropose = me?.id === technicianId && can(resource, "propose");
  const copy = COPY[kind];

  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const areaName = (id: string) => areas?.find((a) => a.id === id)?.name ?? id;

  const rows: Row[] =
    kind === "job_type"
      ? (data?.jobTypes ?? []).map((j: TechnicianJobType) => ({
          kind,
          catalogId: j.jobTypeId,
          name: jobTypeName(j.jobTypeId),
          status: j.status,
          comments: j.comments,
        }))
      : (data?.serviceAreas ?? []).map((a: TechnicianServiceArea) => ({
          kind,
          catalogId: a.serviceAreaId,
          name: areaName(a.serviceAreaId),
          status: a.status,
          comments: a.comments,
        }));

  const add = canApprove ? { label: copy.assign, open: () => setAssignOpen(true) } : canPropose ? { label: copy.propose, open: () => setProposeOpen(true) } : null;

  return (
    <section data-testid={`assignments-${kind}`} className="relative">
      <div
        role="group"
        aria-label={copy.box}
        className="relative flex min-h-[42px] w-full items-center rounded-[4px] border border-wz-outline bg-white py-[3px] pr-10 pl-[10px]"
      >
        {/* The label in the notch while the box holds something, inside it while empty (FloatingLabel-module). */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute tracking-[0.4px]",
            rows.length
              ? "-top-2 left-2 bg-white px-1 text-[11px] leading-[normal] text-foreground"
              : "top-1/2 left-3 -translate-y-1/2 text-[13px] text-wz-outline-label",
          )}
        >
          {copy.box}
        </span>
        {rows.length ? (
          <div className="flex flex-wrap gap-x-1 gap-y-1">
            {rows.map((row) => (
              <AssignmentChip
                key={`${row.kind}:${row.catalogId}`}
                row={row}
                canApprove={canApprove}
                canRevoke={canRevoke}
                approving={approve.isPending}
                revoking={revoke.isPending}
                onApprove={() => approve.mutate({ id: technicianId, kind: row.kind, catalogId: row.catalogId })}
                onReject={() => setRejectTarget(row)}
                onRevoke={() => revoke.mutate({ id: technicianId, kind: row.kind, catalogId: row.catalogId })}
              />
            ))}
          </div>
        ) : (
          <span className="sr-only">{copy.empty}</span>
        )}
        {add ? (
          <button
            type="button"
            onClick={add.open}
            aria-label={add.label}
            className="absolute top-1/2 right-[9px] grid size-6 -translate-y-1/2 place-items-center rounded-[4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus"
          >
            <ChevronDown className="size-[18px]" strokeWidth={1.5} />
          </button>
        ) : null}
      </div>

      <RejectDialog row={rejectTarget} onClose={() => setRejectTarget(null)} technicianId={technicianId} />
      <ProposeDialog technicianId={technicianId} kind={proposeOpen ? kind : null} onClose={() => setProposeOpen(false)} />
      <AssignDirectDialog technicianId={technicianId} kind={assignOpen ? kind : null} onClose={() => setAssignOpen(false)} />
    </section>
  );
}

/**
 * Both catalogs, one under the other, each under its Workiz title — the
 * technician's own page, where they sit together rather than in the columns
 * of the manager's card.
 */
export function TechnicianAssignments({ technicianId }: { technicianId: string }) {
  return (
    <div className="max-w-[480px] space-y-6">
      {(["job_type", "service_area"] as const).map((kind) => (
        <div key={kind} className="space-y-[37px]">
          <WzFormSectionTitle>{COPY[kind].title}</WzFormSectionTitle>
          <AssignmentsSection technicianId={technicianId} kind={kind} />
        </div>
      ))}
    </div>
  );
}

/** The chip's look by review state: Workiz's plain chip for an approved entry, ours for the two still in review. */
const CHIP_TONE: Record<AssignmentStatus, string> = {
  approved: "bg-wz-secondary-hover text-wz-slate",
  pending: "bg-warning/15 text-wz-slate ring-1 ring-warning/60 ring-inset",
  rejected: "bg-wz-danger/10 text-wz-danger ring-1 ring-wz-danger/40 ring-inset",
};

function AssignmentChip({
  row,
  canApprove,
  canRevoke,
  approving,
  revoking,
  onApprove,
  onReject,
  onRevoke,
}: {
  row: Row;
  canApprove: boolean;
  canRevoke: boolean;
  approving: boolean;
  revoking: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRevoke: () => void;
}) {
  const action = "grid w-[26px] shrink-0 place-items-center self-stretch rounded-r-chip hover:bg-black/5 disabled:opacity-50";
  return (
    <span
      data-status={row.status}
      className={cn("inline-flex h-[22px] items-stretch rounded-chip text-xs leading-4 font-medium tracking-[0.4px]", CHIP_TONE[row.status])}
      title={row.comments || undefined}
    >
      <span className="flex items-center py-[3px] pr-[3px] pl-1.5">{row.name}</span>
      {row.status === "pending" && canApprove ? (
        <>
          <button type="button" onClick={onApprove} disabled={approving} className={cn(action, "rounded-none")} aria-label={`Approve ${row.name}`}>
            <Check className="size-3.5" strokeWidth={2.5} />
          </button>
          <button type="button" onClick={onReject} className={action} aria-label={`Reject ${row.name}`}>
            <X className="size-[15px]" strokeWidth={1.75} />
          </button>
        </>
      ) : row.status === "approved" && canRevoke ? (
        <button type="button" onClick={onRevoke} disabled={revoking} className={action} aria-label={`Remove ${row.name}`}>
          <X className="size-[15px]" strokeWidth={1.75} />
        </button>
      ) : row.status === "pending" ? (
        <span className="flex items-center pr-1.5 text-[11px] opacity-70">pending</span>
      ) : null}
    </span>
  );
}

function RejectDialog({
  row,
  technicianId,
  onClose,
}: {
  row: Row | null;
  technicianId: string;
  onClose: () => void;
}) {
  const reject = useRejectAssignment();
  const [reason, setReason] = useState("");
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && (onClose(), setReason(""))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject “{row?.name}”?</DialogTitle>
          <DialogDescription>A reason is required and shown to the technician.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Certification not verified" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
            disabled={!reason.trim() || reject.isPending}
            onClick={() =>
              row &&
              reject.mutate(
                { id: technicianId, kind: row.kind, catalogId: row.catalogId, comments: reason.trim() },
                { onSuccess: () => { onClose(); setReason(""); } },
              )
            }
          >
            {reject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Technician self-service: propose catalog entries of one kind for review. */
function ProposeDialog({
  technicianId,
  kind,
  onClose,
}: {
  technicianId: string;
  kind: AssignmentKind | null;
  onClose: () => void;
}) {
  const propose = useProposeAssignments();
  const [ids, setIds] = useState<string[]>([]);

  const close = () => { onClose(); setIds([]); };
  const submit = () => {
    if (!kind || !ids.length) return;
    propose.mutate({ id: technicianId, kind, ids }, { onSuccess: close });
  };

  const isJobType = kind === "job_type";
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose {isJobType ? "job types" : "service areas"}</DialogTitle>
          <DialogDescription>They&apos;ll go to a manager for review.</DialogDescription>
        </DialogHeader>
        {isJobType ? (
          <JobTypePicker value={ids} onChange={setIds} />
        ) : (
          <ServiceAreaPicker value={ids} onChange={setIds} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button variant="brand" className="gap-1.5" disabled={!ids.length || propose.isPending} onClick={submit}>
            {propose.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Propose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Manager path: grant catalog entries of one kind directly (pre-approved). */
function AssignDirectDialog({
  technicianId,
  kind,
  onClose,
}: {
  technicianId: string;
  kind: AssignmentKind | null;
  onClose: () => void;
}) {
  const assign = useAssignDirect();
  const [ids, setIds] = useState<string[]>([]);

  const close = () => { onClose(); setIds([]); };
  const submit = () => {
    if (!kind || !ids.length) return;
    assign.mutate({ id: technicianId, kind, ids }, { onSuccess: close });
  };

  const isJobType = kind === "job_type";
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {isJobType ? "job types" : "service areas"}</DialogTitle>
          <DialogDescription>
            Grant catalog {isJobType ? "job types" : "service areas"} to this technician directly — no approval needed.
          </DialogDescription>
        </DialogHeader>
        {isJobType ? (
          <JobTypePicker value={ids} onChange={setIds} />
        ) : (
          <ServiceAreaPicker value={ids} onChange={setIds} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>Cancel</Button>
          <Button variant="brand" className="gap-1.5" disabled={!ids.length || assign.isPending} onClick={submit}>
            {assign.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Assign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
