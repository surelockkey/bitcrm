"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { JobType } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useCreateJobType, useUpdateJobType } from "../hooks";
import { jobTypeFormSchema, toJobTypeBody } from "../schemas";

export function JobTypeFormDialog({
  jobType,
  open,
  onOpenChange,
}: {
  jobType?: JobType;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(jobType);
  const create = useCreateJobType();
  const update = useUpdateJobType(jobType?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(jobType?.name ?? "");
  const [priority, setPriority] = useState(String(jobType?.priority ?? 0));
  const [active, setActive] = useState(jobType?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobTypeFormSchema.safeParse({ name, priority, active }),
    [name, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobTypeBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${jobType!.name}` : "New job type"}</DialogTitle>
          <DialogDescription>
            A kind of work you dispatch. Deals pick one; technicians are approved for it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lockout" />
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Input className="h-9" type="number" min={0} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Only active types show in deal and technician pickers.</p>
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
