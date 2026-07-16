"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@bitcrm/types";
import { useRoleAccess } from "../use-role-access";
import { useCreateRole } from "../hooks";
import { createRoleSchema, type CreateRoleValues } from "../schemas";
import { priorityBetween, sortRolesByPriority } from "../lib";

interface Slot {
  label: string;
  priority: number;
}

/** Relative insertion points derived from the current role ranking. */
function buildSlots(roles: Role[], cap: number): Slot[] {
  const ranked = sortRolesByPriority(roles.filter((r) => r.priority < cap));
  if (!ranked.length) return [{ label: "Standalone", priority: Math.min(50, cap - 1) }];
  const slots: Slot[] = [
    { label: `Above ${ranked[0].name}`, priority: priorityBetween(cap, ranked[0].priority) },
  ];
  for (let i = 0; i < ranked.length; i++) {
    const above = ranked[i].priority;
    const below = ranked[i + 1]?.priority ?? 0;
    slots.push({
      label: ranked[i + 1]
        ? `Between ${ranked[i].name} and ${ranked[i + 1].name}`
        : `Below ${ranked[i].name}`,
      priority: priorityBetween(above, below),
    });
  }
  return slots;
}

export function CreateRoleDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
}) {
  const router = useRouter();
  const { myPriority, amSuperAdmin } = useRoleAccess();
  const createRole = useCreateRole();

  const cap = amSuperAdmin ? 100 : myPriority;
  const assignable = useMemo(
    () => sortRolesByPriority(roles.filter((r) => amSuperAdmin || r.priority < myPriority)),
    [roles, amSuperAdmin, myPriority],
  );
  const slots = useMemo(() => buildSlots(roles, cap), [roles, cap]);

  const defaultStart = assignable[0]?.id ?? "";
  const defaultSlotIndex = Math.max(
    0,
    slots.findIndex((s) => s.priority < (assignable[0]?.priority ?? cap)),
  );

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: "",
      description: "",
      startFromRoleId: defaultStart,
      priority: slots[defaultSlotIndex]?.priority ?? Math.min(50, cap - 1),
    },
  });

  const selectedPriority = useWatch({ control: form.control, name: "priority" });
  const startFromRoleId = useWatch({ control: form.control, name: "startFromRoleId" });

  const onSubmit = (values: CreateRoleValues) => {
    const source = roles.find((r) => r.id === values.startFromRoleId);
    if (!source) return;
    createRole.mutate(
      {
        name: values.name,
        description: values.description || undefined,
        permissions: source.permissions,
        dataScope: source.dataScope,
        dealStageTransitions: source.dealStageTransitions,
        priority: values.priority,
      },
      {
        onSuccess: (role) => {
          form.reset();
          onOpenChange(false);
          router.push(`/admin/roles/${role.id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Start from an existing role, then fine-tune its permissions.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Name</Label>
            <Input id="role-name" className="h-10" {...form.register("name")} />
            {form.formState.errors.name ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea
              id="role-desc"
              rows={2}
              placeholder="What is this role for?"
              {...form.register("description")}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Start from</Label>
            <Select
              value={startFromRoleId}
              onValueChange={(v) => form.setValue("startFromRoleId", v)}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Pick a role" />
              </SelectTrigger>
              <SelectContent>
                {assignable.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}{" "}
                    <span className="text-muted-foreground">· priority {r.priority}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Copies its permissions, data scope, and stage transitions as a starting point.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Rank</Label>
            <Select
              value={String(selectedPriority)}
              onValueChange={(v) => form.setValue("priority", Number(v))}
            >
              <SelectTrigger className="h-10 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {slots.map((s, i) => (
                  <SelectItem key={i} value={String(s.priority)}>
                    {s.label}{" "}
                    <span className="text-muted-foreground">· {s.priority}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Priority {selectedPriority} — you can only create roles below your own.
            </p>
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
              type="submit"
              variant="brand"
              disabled={createRole.isPending}
              className="gap-1.5"
            >
              {createRole.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create &amp; edit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
