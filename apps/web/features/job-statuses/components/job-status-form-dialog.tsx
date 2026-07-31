"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  JOB_TAG_COLORS,
  DealStageGroup,
  type DealSubStatus,
  type JobTagColor,
} from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { GROUP_ORDER, groupLabel } from "@/features/deals/lib";
import { useCreateJobStatus, useUpdateJobStatus } from "../hooks";
import { jobStatusFormSchema, toJobStatusBody } from "../schemas";
import { STATUS_COLOR_CLASSES, STATUS_SWATCH_CLASSES } from "../lib";

export function JobStatusFormDialog({
  status,
  defaultGroup,
  open,
  onOpenChange,
}: {
  status?: DealSubStatus;
  /** Pre-select the super-status when adding from a group section. */
  defaultGroup?: DealStageGroup;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(status);
  const create = useCreateJobStatus();
  const update = useUpdateJobStatus(status?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(status?.name ?? "");
  const [group, setGroup] = useState<DealStageGroup>(
    status?.group ?? defaultGroup ?? DealStageGroup.SUBMITTED,
  );
  const [color, setColor] = useState<JobTagColor>(status?.color ?? "slate");
  const [priority, setPriority] = useState(String(status?.priority ?? 0));
  const [active, setActive] = useState(status?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobStatusFormSchema.safeParse({ name, group, color, priority, active }),
    [name, group, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobStatusBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${status!.name}` : "New job status"}</DialogTitle>
          <DialogDescription>
            A colored status filed under a super-status (e.g. &ldquo;Will Call Back&rdquo; under Pending).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Super-status</Label>
            <Select value={group} onValueChange={(v) => setGroup(v as DealStageGroup)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_ORDER.map((g) => (
                  <SelectItem key={g} value={g}>
                    {groupLabel(g)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Will Call Back" />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input className="h-9" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {JOB_TAG_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    "grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition",
                    STATUS_SWATCH_CLASSES[c],
                    color === c ? "ring-2 ring-foreground" : "hover:opacity-80",
                  )}
                >
                  {color === c ? <Check className="size-3.5 text-white" strokeWidth={3} /> : null}
                </button>
              ))}
            </div>
            <span
              className={cn(
                "mt-1 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                STATUS_COLOR_CLASSES[color],
              )}
            >
              {name.trim() || "Preview"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Only active statuses show in the job picker.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="brand" className="gap-1.5" disabled={pending || !parsed.success} onClick={submit}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
