"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { JOB_TAG_COLORS, type CallTag, type JobTagColor } from "@bitcrm/types";
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
import { cn } from "@/lib/utils";
import { useCreateCallTag, useUpdateCallTag } from "../hooks";
import { callTagFormSchema, toCallTagBody } from "../schemas";
import { TAG_COLOR_CLASSES, TAG_SWATCH_CLASSES } from "../lib";

/**
 * Create or edit one call tag — name, color, picker priority, and the
 * active/archived switch. The same dialog serves Settings and the inline
 * "Create new" shortcut in the picker on a call.
 */
export function CallTagFormDialog({
  callTag,
  initialName,
  open,
  onOpenChange,
  onCreated,
}: {
  callTag?: CallTag;
  /** Prefills the name when creating, e.g. from the picker's search query. */
  initialName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new tag after a successful create (not on edit). */
  onCreated?: (tag: CallTag) => void;
}) {
  const editing = Boolean(callTag);
  const create = useCreateCallTag();
  const update = useUpdateCallTag(callTag?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(callTag?.name ?? initialName ?? "");
  const [color, setColor] = useState<JobTagColor>(callTag?.color ?? "slate");
  const [priority, setPriority] = useState(String(callTag?.priority ?? 0));
  const [active, setActive] = useState(callTag?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => callTagFormSchema.safeParse({ name, color, priority, active }),
    [name, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toCallTagBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, {
      onSuccess: (saved) => {
        if (!editing) onCreated?.(saved);
        onOpenChange(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${callTag!.name}` : "New call tag"}
          </DialogTitle>
          <DialogDescription>
            A colored label a call can be tagged with (e.g. SPAM CALLER, Tech
            Call, WRONG NUMBER).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="call-tag-name">Name</Label>
              <Input
                id="call-tag-name"
                className="h-9"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="SPAM CALLER"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="call-tag-priority">Priority</Label>
              <Input
                id="call-tag-priority"
                className="h-9"
                type="number"
                min={0}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
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
                    TAG_SWATCH_CLASSES[c],
                    color === c ? "ring-2 ring-foreground" : "hover:opacity-80",
                  )}
                >
                  {color === c ? (
                    <Check className="size-3.5 text-white" strokeWidth={3} />
                  ) : null}
                </button>
              ))}
            </div>
            <span
              className={cn(
                "mt-1 inline-flex items-center rounded-chip border px-2.5 py-0.5 text-xs font-medium",
                TAG_COLOR_CLASSES[color],
              )}
            >
              {name.trim() || "Preview"}
            </span>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">
                Archived tags leave every picker but keep naming the calls that
                already carry them.
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            className="gap-1.5"
            disabled={pending || !parsed.success}
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
