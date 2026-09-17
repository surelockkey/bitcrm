"use client";

import { useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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

/** Label, empty state and action wording for one catalog. */
const COPY: Record<AssignmentKind, { label: string; empty: string; assign: string }> = {
  job_type: {
    label: "Job types — what they can do",
    empty: "No job types yet.",
    assign: "Assign job types",
  },
  service_area: {
    label: "Service areas — where they work",
    empty: "No service areas yet.",
    assign: "Assign areas",
  },
};

/**
 * One catalog's assignments — the chips and the review actions on them.
 *
 * One kind per instance because the card puts the two in different places in
 * the work column (Workiz sets User skills between them) and because each kind
 * carries its own approve/revoke/propose rights. Each instance owns its
 * dialogs, so the two can never share a half-open state.
 */
export function AssignmentsSection({
  technicianId,
  kind,
}: {
  technicianId: string;
  kind: AssignmentKind;
}) {
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

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <Label className="block text-[11px] tracking-wide uppercase">{copy.label}</Label>
        {canApprove ? (
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="size-3" /> {copy.assign}
          </button>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {rows.length === 0 ? (
          <span className="text-sm text-muted-foreground">{copy.empty}</span>
        ) : (
          rows.map((row) => (
            <AssignmentChip
              key={`${row.kind}:${row.catalogId}`}
              row={row}
              canApprove={canApprove}
              canRevoke={canRevoke}
              approving={approve.isPending}
              revoking={revoke.isPending}
              onApprove={() =>
                approve.mutate({ id: technicianId, kind: row.kind, catalogId: row.catalogId })
              }
              onReject={() => setRejectTarget(row)}
              onRevoke={() =>
                revoke.mutate({ id: technicianId, kind: row.kind, catalogId: row.catalogId })
              }
            />
          ))
        )}
        {canPropose ? (
          <button
            type="button"
            onClick={() => setProposeOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" /> propose
          </button>
        ) : null}
      </div>

      <RejectDialog row={rejectTarget} onClose={() => setRejectTarget(null)} technicianId={technicianId} />
      <ProposeDialog
        technicianId={technicianId}
        kind={proposeOpen ? kind : null}
        onClose={() => setProposeOpen(false)}
      />
      <AssignDirectDialog
        technicianId={technicianId}
        kind={assignOpen ? kind : null}
        onClose={() => setAssignOpen(false)}
      />
    </section>
  );
}

/**
 * Both catalogs, one under the other — the technician's own page, where they
 * sit together rather than in the columns of the manager's card.
 */
export function TechnicianAssignments({ technicianId }: { technicianId: string }) {
  return (
    <div className="max-w-2xl space-y-6">
      <AssignmentsSection technicianId={technicianId} kind="job_type" />
      <AssignmentsSection technicianId={technicianId} kind="service_area" />
    </div>
  );
}

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
  const tone =
    row.status === "approved"
      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500"
      : row.status === "rejected"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", tone)}
      title={row.comments || undefined}
    >
      <span className="font-medium">{row.name}</span>
      {row.status === "pending" && canApprove ? (
        <>
          <button type="button" onClick={onApprove} disabled={approving} className="hover:opacity-70" aria-label="Approve">
            <Check className="size-3.5" strokeWidth={3} />
          </button>
          <button type="button" onClick={onReject} className="hover:opacity-70" aria-label="Reject">
            <X className="size-3.5" strokeWidth={3} />
          </button>
        </>
      ) : row.status === "approved" && canRevoke ? (
        <button type="button" onClick={onRevoke} disabled={revoking} className="opacity-60 hover:opacity-100" aria-label="Revoke">
          <X className="size-3.5" />
        </button>
      ) : row.status === "pending" ? (
        <span className="opacity-70">pending</span>
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
