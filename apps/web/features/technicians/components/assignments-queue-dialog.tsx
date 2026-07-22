"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { User } from "@bitcrm/types";
import { formatDate } from "@/features/users/lib";
import { usePendingAssignments, useApproveAssignment, useRejectAssignment } from "../hooks";
import type { AssignmentKind } from "../api";
import { techName } from "../lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { useServiceAreas } from "@/features/service-areas/hooks";

interface QueueRow {
  kind: AssignmentKind;
  userId: string;
  catalogId: string;
  name: string;
  proposedAt: string;
}

export function AssignmentsQueueDialog({
  open,
  onOpenChange,
  userMap,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userMap: Map<string, User>;
}) {
  const { data, isLoading } = usePendingAssignments(open);
  const approve = useApproveAssignment();
  const reject = useRejectAssignment();
  const jobTypeName = useJobTypeName();
  const { data: areas } = useServiceAreas();

  const [rejectTarget, setRejectTarget] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");

  const rows = useMemo<QueueRow[]>(() => {
    const areaName = (id: string) => areas?.find((a) => a.id === id)?.name ?? id;
    const jobTypeRows: QueueRow[] = (data?.jobTypes ?? []).map((j) => ({
      kind: "job_type",
      userId: j.userId,
      catalogId: j.jobTypeId,
      name: jobTypeName(j.jobTypeId),
      proposedAt: j.proposedAt,
    }));
    const areaRows: QueueRow[] = (data?.serviceAreas ?? []).map((a) => ({
      kind: "service_area",
      userId: a.userId,
      catalogId: a.serviceAreaId,
      name: areaName(a.serviceAreaId),
      proposedAt: a.proposedAt,
    }));
    return [...jobTypeRows, ...areaRows];
  }, [data, areas, jobTypeName]);

  const doReject = () => {
    if (!rejectTarget || !reason.trim()) return;
    reject.mutate(
      { id: rejectTarget.userId, kind: rejectTarget.kind, catalogId: rejectTarget.catalogId, comments: reason.trim() },
      {
        onSuccess: () => {
          setRejectTarget(null);
          setReason("");
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Assignments awaiting review</DialogTitle>
            <DialogDescription>
              Approve or reject proposed job types &amp; service areas. Approving one of each
              makes a technician assignable.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              Nothing to review — you&apos;re all caught up.
            </p>
          ) : (
            <div className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {rows.map((row) => (
                <div key={`${row.kind}:${row.userId}:${row.catalogId}`} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {techName(row.userId, userMap)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="secondary" className="font-normal">
                        {row.kind === "job_type" ? "Job type" : "Service area"}
                      </Badge>
                      <span className="font-medium text-foreground">{row.name}</span>
                      <span>· {formatDate(row.proposedAt)}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 text-green-600 dark:text-green-500"
                    disabled={approve.isPending}
                    onClick={() => approve.mutate({ id: row.userId, kind: row.kind, catalogId: row.catalogId })}
                  >
                    <Check className="size-3.5" />
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-destructive"
                    onClick={() => setRejectTarget(row)}
                  >
                    <X className="size-3.5" />
                    Reject
                  </Button>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject reason (required) */}
      <Dialog open={rejectTarget !== null} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject “{rejectTarget?.name}”?</DialogTitle>
            <DialogDescription>A reason is required and shown to the technician.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Certification not verified"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              className="gap-1.5 bg-destructive hover:bg-destructive/90"
              disabled={!reason.trim() || reject.isPending}
              onClick={doReject}
            >
              {reject.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
