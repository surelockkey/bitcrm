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
import type { TechnicianSkill, SkillType } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useSkills,
  useApproveSkill,
  useRejectSkill,
  useRevokeSkill,
  useProposeSkills,
} from "../hooks";
import { groupSkills, JOB_TYPE_SUGGESTIONS } from "../lib";

export function SkillsTab({ technicianId }: { technicianId: string }) {
  const { me, can } = usePermissions();
  const { data: skills, isLoading } = useSkills(technicianId);
  const approve = useApproveSkill();
  const revoke = useRevokeSkill();
  const [rejectTarget, setRejectTarget] = useState<TechnicianSkill | null>(null);
  const [proposeOpen, setProposeOpen] = useState(false);

  const canApprove = can("skills", "approve");
  const canRevoke = can("skills", "revoke");
  const canPropose = me?.id === technicianId && can("skills", "propose");

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const { jobTypes, serviceAreas } = groupSkills(skills ?? []);

  const chipList = (list: TechnicianSkill[], emptyText: string) => (
    <div className="flex flex-wrap gap-2">
      {list.length === 0 ? (
        <span className="text-sm text-muted-foreground">{emptyText}</span>
      ) : (
        list.map((s) => (
          <SkillChip
            key={s.skillId}
            skill={s}
            canApprove={canApprove}
            canRevoke={canRevoke}
            approving={approve.isPending}
            revoking={revoke.isPending}
            onApprove={() => approve.mutate({ id: technicianId, skillId: s.skillId })}
            onReject={() => setRejectTarget(s)}
            onRevoke={() => revoke.mutate({ id: technicianId, skillId: s.skillId })}
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
  );

  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <Label className="mb-2 block text-[11px] tracking-wide uppercase">Job types — what they can do</Label>
        {chipList(jobTypes, "No job types yet.")}
      </section>
      <section>
        <Label className="mb-2 block text-[11px] tracking-wide uppercase">Service areas — where they work</Label>
        {chipList(serviceAreas, "No service areas yet.")}
      </section>

      <RejectDialog
        skill={rejectTarget}
        onClose={() => setRejectTarget(null)}
        technicianId={technicianId}
      />
      <ProposeDialog technicianId={technicianId} open={proposeOpen} onOpenChange={setProposeOpen} />
    </div>
  );
}

function SkillChip({
  skill,
  canApprove,
  canRevoke,
  approving,
  revoking,
  onApprove,
  onReject,
  onRevoke,
}: {
  skill: TechnicianSkill;
  canApprove: boolean;
  canRevoke: boolean;
  approving: boolean;
  revoking: boolean;
  onApprove: () => void;
  onReject: () => void;
  onRevoke: () => void;
}) {
  const tone =
    skill.status === "approved"
      ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-500"
      : skill.status === "rejected"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-500";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", tone)}
      title={skill.comments || undefined}
    >
      <span className="font-medium">{skill.value}</span>
      {skill.status === "pending" && canApprove ? (
        <>
          <button type="button" onClick={onApprove} disabled={approving} className="hover:opacity-70" aria-label="Approve">
            <Check className="size-3.5" strokeWidth={3} />
          </button>
          <button type="button" onClick={onReject} className="hover:opacity-70" aria-label="Reject">
            <X className="size-3.5" strokeWidth={3} />
          </button>
        </>
      ) : skill.status === "approved" && canRevoke ? (
        <button type="button" onClick={onRevoke} disabled={revoking} className="opacity-60 hover:opacity-100" aria-label="Revoke">
          <X className="size-3.5" />
        </button>
      ) : skill.status === "pending" ? (
        <span className="opacity-70">pending</span>
      ) : null}
    </span>
  );
}

function RejectDialog({
  skill,
  technicianId,
  onClose,
}: {
  skill: TechnicianSkill | null;
  technicianId: string;
  onClose: () => void;
}) {
  const reject = useRejectSkill();
  const [reason, setReason] = useState("");
  return (
    <Dialog open={skill !== null} onOpenChange={(o) => !o && (onClose(), setReason(""))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject “{skill?.value}”?</DialogTitle>
          <DialogDescription>A reason is required and shown to the technician.</DialogDescription>
        </DialogHeader>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Certification not verified" />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
            disabled={!reason.trim() || reject.isPending}
            onClick={() =>
              skill &&
              reject.mutate(
                { id: technicianId, skillId: skill.skillId, comments: reason.trim() },
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

function ProposeDialog({
  technicianId,
  open,
  onOpenChange,
}: {
  technicianId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const propose = useProposeSkills();
  const [jobTypes, setJobTypes] = useState("");
  const [serviceAreas, setServiceAreas] = useState("");
  const parse = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

  const submit = () => {
    const body = { jobTypes: parse(jobTypes), serviceAreas: parse(serviceAreas) };
    if (!body.jobTypes.length && !body.serviceAreas.length) return;
    propose.mutate({ id: technicianId, body }, { onSuccess: () => { onOpenChange(false); setJobTypes(""); setServiceAreas(""); } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose skills</DialogTitle>
          <DialogDescription>They&apos;ll go to a manager for review. One per line or comma-separated.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Job types</Label>
            <Textarea rows={2} value={jobTypes} onChange={(e) => setJobTypes(e.target.value)} placeholder={JOB_TYPE_SUGGESTIONS.slice(0, 4).join(", ")} />
          </div>
          <div className="space-y-1.5">
            <Label>Service areas</Label>
            <Textarea rows={2} value={serviceAreas} onChange={(e) => setServiceAreas(e.target.value)} placeholder="Phoenix, Scottsdale" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" className="gap-1.5" disabled={propose.isPending} onClick={submit}>
            {propose.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Propose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type { SkillType };
