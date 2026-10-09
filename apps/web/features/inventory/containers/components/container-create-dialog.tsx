"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { WzButton } from "@/components/workiz/button";
import {
  LocationDialog,
  LocationFields,
  LocationFooter,
  LocationInput,
  LocationTextarea,
} from "@/features/inventory/components/location-form";
import { TemplateSelect } from "@/features/inventory/templates/components/template-select";
import { useCreateContainer } from "../hooks";
import { containerSchema, type ContainerValues } from "../schemas";
import { LocationStep } from "./container-edit-dialog";

/**
 * Workiz's "Create New Location" for a van: Location Name and Description,
 * then BitCRM's department and template; Cancel / Save. Who works from it is
 * set on User locations.
 */
export function ContainerCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateContainer();
  const [templateId, setTemplateId] = useState<string | null>(null);
  const form = useForm<ContainerValues>({
    resolver: zodResolver(containerSchema),
    defaultValues: { name: "", description: "", department: "" },
  });

  const onSubmit = (values: ContainerValues) =>
    create.mutate(
      { ...values, ...(templateId ? { templateId } : {}) },
      {
        // The new van shows up in the list; stock reaches it from the
        // Inventory tab, and who works from it is set on User locations.
        onSuccess: () => {
          form.reset();
          setTemplateId(null);
          onOpenChange(false);
        },
      },
    );

  return (
    <LocationDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create New Location"
      description="A mobile stock location — a van or truck. Who works from it is set on User locations."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex min-h-0 flex-col">
        <LocationFields>
          <LocationInput label="Location Name" error={form.formState.errors.name?.message} {...form.register("name")} />
          <LocationTextarea label="Description" {...form.register("description")} />
          <LocationInput label="Department" {...form.register("department")} />
          <LocationStep label="Template" htmlFor="ct-template">
            <TemplateSelect id="ct-template" value={templateId} onChange={setTemplateId} />
          </LocationStep>
        </LocationFields>
        <LocationFooter>
          <WzButton variant="tertiary" size="big" onClick={() => onOpenChange(false)}>
            Cancel
          </WzButton>
          <WzButton type="submit" variant="primary" size="big" loading={create.isPending}>
            Save
          </WzButton>
        </LocationFooter>
      </form>
    </LocationDialog>
  );
}
