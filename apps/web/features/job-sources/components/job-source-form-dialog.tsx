"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { JobSource } from "@bitcrm/types";
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
import { useCreateJobSource, useUpdateJobSource } from "../hooks";
import { jobSourceFormSchema, toJobSourceBody } from "../schemas";

export function JobSourceFormDialog({
  jobSource,
  open,
  onOpenChange,
}: {
  jobSource?: JobSource;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(jobSource);
  const create = useCreateJobSource();
  const update = useUpdateJobSource(jobSource?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(jobSource?.name ?? "");
  const [priority, setPriority] = useState(String(jobSource?.priority ?? 0));
  const [active, setActive] = useState(jobSource?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobSourceFormSchema.safeParse({ name, priority, active }),
    [name, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobSourceBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${jobSource!.name}` : "New job source"}</DialogTitle>
          <DialogDescription>
            A lead source a deal can be tagged with (e.g. Google Ads, Referral).
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
              <p className="text-xs text-muted-foreground">Only active sources show in the deal picker.</p>
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
