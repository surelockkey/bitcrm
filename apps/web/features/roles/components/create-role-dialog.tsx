"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Role } from "@bitcrm/types";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzModalTextField } from "@/components/workiz/modal-text-field";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
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
  const slots: Slot[] = [{ label: `Above ${ranked[0].name}`, priority: priorityBetween(cap, ranked[0].priority) }];
  for (let i = 0; i < ranked.length; i++) {
    const above = ranked[i].priority;
    const below = ranked[i + 1]?.priority ?? 0;
    slots.push({
      label: ranked[i + 1] ? `Between ${ranked[i].name} and ${ranked[i + 1].name}` : `Below ${ranked[i].name}`,
      priority: priorityBetween(above, below),
    });
  }
  return slots;
}

/**
 * "Add New Role" as one of Workiz's settings modals (`WzFormModal`, the
 * "Add New Job Type" one: 500px, the 18px/600 title, outlined 40px boxes 24px
 * apart, Cancel / Save): the name, what the role is for, the role whose
 * permissions, data scope and stage moves it starts as a copy of, and where it
 * ranks (only below your own). Save makes it and opens its permissions.
 */
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
  const defaultSlotIndex = Math.max(0, slots.findIndex((s) => s.priority < (assignable[0]?.priority ?? cap)));

  const form = useForm<CreateRoleValues>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: {
      name: "",
      description: "",
      startFromRoleId: defaultStart,
      priority: slots[defaultSlotIndex]?.priority ?? Math.min(50, cap - 1),
    },
  });

  const name = useWatch({ control: form.control, name: "name" });
  const description = useWatch({ control: form.control, name: "description" });
  const selectedPriority = useWatch({ control: form.control, name: "priority" });
  const startFromRoleId = useWatch({ control: form.control, name: "startFromRoleId" });
  const errors = form.formState.errors;

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
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title="Add New Role"
      description="Start from an existing role, then fine-tune its permissions."
      onSave={() => void form.handleSubmit(onSubmit)()}
      saving={createRole.isPending}
    >
      <WzModalTextField
        label="Name"
        value={name ?? ""}
        onChange={(v) => form.setValue("name", v, { shouldValidate: form.formState.isSubmitted })}
        error={errors.name?.message}
      />
      <WzModalTextField
        label="Description"
        value={description ?? ""}
        onChange={(v) => form.setValue("description", v, { shouldValidate: form.formState.isSubmitted })}
        helper="What is this role for?"
        error={errors.description?.message}
      />
      <div>
        <WzOutlinedSelect
          label="Copy permissions from"
          options={assignable.map((r) => ({ value: r.id, label: r.name }))}
          value={startFromRoleId}
          onChange={(v) => form.setValue("startFromRoleId", v, { shouldValidate: form.formState.isSubmitted })}
          error={errors.startFromRoleId?.message}
        />
        <p className="mt-1 pl-[12.5px] text-xs leading-[18px] text-foreground">
          Copies its permissions, data scope and stage moves as a starting point.
        </p>
      </div>
      <div>
        <WzOutlinedSelect
          label="Rank"
          options={slots.map((s) => ({ value: String(s.priority), label: `${s.label} · ${s.priority}` }))}
          value={String(selectedPriority)}
          onChange={(v) => form.setValue("priority", Number(v))}
        />
        <p className="mt-1 pl-[12.5px] text-xs leading-[18px] text-foreground">
          Priority {selectedPriority} — you can only create roles below your own.
        </p>
      </div>
    </WzFormModal>
  );
}
