"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WzButton } from "@/components/workiz/button";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  LocationDialog,
  LocationFields,
  LocationFooter,
  LocationInput,
  LocationTextarea,
} from "@/features/inventory/components/location-form";
import { TemplateSelect } from "@/features/inventory/templates/components/template-select";
import { useUserContainers, useUserNames } from "@/features/inventory/user-containers/hooks";
import {
  containerUserNames,
  unnamedUserIds,
  usersOfContainer,
} from "@/features/inventory/user-containers/lib";
import { useContainer, useUpdateContainer } from "../hooks";
import type { UpdateContainerBody } from "../api";
import { containerSchema } from "../schemas";

/** A labelled step of the popup — the Move popup's "Move" / "To": 14px/21px 600 ink. */
export function LocationStep({ htmlFor, label, children }: { htmlFor?: string; label: string; children: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <label htmlFor={htmlFor} className="text-sm leading-[21px] font-semibold text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A van's Workiz "Edit Location" popup — Inventory has no container page.
 * Opened from the row's pencil; view-only without `containers.edit`. Workiz's
 * Location Name and Description, then BitCRM's own: department, template,
 * who works from it and whether it is active.
 */
export function ContainerEditDialog({
  containerId,
  open,
  onOpenChange,
}: {
  containerId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { can } = usePermissions();
  const query = useContainer(containerId, open);
  const canEdit = can("containers", "edit");
  const close = () => onOpenChange(false);

  let title = canEdit ? "Edit Location" : "Location";
  let content: ReactNode;
  if (query.isLoading) {
    content = (
      <div data-testid="container-edit-loading" aria-busy="true" className="flex flex-col">
        <LocationFields>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[132px] w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[71px] w-full" />
          <Skeleton className="h-10 w-full" />
        </LocationFields>
        <div data-testid="dialog-footer-placeholder" aria-hidden className="mt-[61px] flex justify-end gap-4">
          <Skeleton className="h-10 w-24 rounded-pill" />
          <Skeleton className="h-10 w-20 rounded-pill" />
        </div>
      </div>
    );
  } else if (query.isError || !query.data) {
    title = "Location not found";
    content = (
      <>
        <p className="mt-4 text-sm text-wz-outline-label">It may have been deleted.</p>
        <LocationFooter>
          <WzButton variant="secondary" size="big" onClick={close}>
            Close
          </WzButton>
        </LocationFooter>
      </>
    );
  } else {
    // Keyed by the save time: a fresh copy of the van starts a fresh form.
    content = <ContainerForm key={query.data.updatedAt} container={query.data} readOnly={!canEdit} onClose={close} />;
  }

  return (
    <LocationDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="The van's name, description, department, template and status."
    >
      {content}
    </LocationDialog>
  );
}

function ContainerForm({
  container,
  readOnly,
  onClose,
}: {
  container: Container;
  readOnly: boolean;
  onClose: () => void;
}) {
  const update = useUpdateContainer();
  const [name, setName] = useState(container.name ?? "");
  const [description, setDescription] = useState(container.description ?? "");
  const [department, setDepartment] = useState(container.department ?? "");
  const [templateId, setTemplateId] = useState<string | null>(container.templateId ?? null);
  const [active, setActive] = useState(container.status !== InventoryStatus.ARCHIVED);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const parsed = containerSchema.safeParse({ name, description, department });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields");
      return;
    }
    const body: UpdateContainerBody = {
      name: parsed.data.name,
      description: parsed.data.description ?? "",
      department: parsed.data.department ?? "",
      templateId,
      status: active ? InventoryStatus.ACTIVE : InventoryStatus.ARCHIVED,
    };
    const unchanged =
      body.name === (container.name ?? "") &&
      body.description === (container.description ?? "") &&
      body.department === (container.department ?? "") &&
      body.templateId === (container.templateId ?? null) &&
      body.status === container.status;
    if (unchanged) return onClose();
    update.mutate({ id: container.id, body }, { onSuccess: onClose });
  };

  return (
    <form
      className="flex min-h-0 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) save();
      }}
    >
      <LocationFields>
        {readOnly ? <p className="text-sm text-wz-outline-label">You have view-only access to containers.</p> : null}
        <LocationInput
          label="Location Name"
          disabled={readOnly}
          value={name}
          error={error ?? undefined}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <LocationTextarea
          label="Description"
          disabled={readOnly}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <LocationInput
          label="Department"
          disabled={readOnly}
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
        <LocationStep label="Template" htmlFor="c-template">
          <TemplateSelect id="c-template" value={templateId} onChange={setTemplateId} disabled={readOnly} />
          <p className="-mt-1 text-[11px] leading-4 text-wz-outline-label">The van&apos;s ideal loadout.</p>
        </LocationStep>
        <VanUsers container={container} />
        {/* BitCRM's status, as a Workiz switch row: the words at the left, the switch at the right. */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm leading-4 text-foreground">Active</span>
            <span className="block text-[11px] leading-4 text-wz-outline-label">
              Inactive vans are hidden from transfer pickers.
            </span>
          </span>
          <Switch aria-label="Active" disabled={readOnly} checked={active} onCheckedChange={setActive} />
        </div>
      </LocationFields>

      <LocationFooter>
        {readOnly ? (
          <WzButton variant="secondary" size="big" onClick={onClose}>
            Close
          </WzButton>
        ) : (
          <>
            <WzButton variant="tertiary" size="big" onClick={onClose}>
              Cancel
            </WzButton>
            <WzButton type="submit" variant="primary" size="big" loading={update.isPending}>
              Save
            </WzButton>
          </>
        )}
      </LocationFooter>
    </form>
  );
}

/**
 * Who works from the van — read-only here. Several people may share a van,
 * and reassigning is done on User locations.
 */
function VanUsers({ container }: { container: Container }) {
  const assignments = useUserContainers();
  const rows = useMemo(() => assignments.data ?? [], [assignments.data]);
  const { names } = useUserNames(useMemo(() => unnamedUserIds(rows), [rows]));
  const users = useMemo(
    () => usersOfContainer(container, containerUserNames(rows, names), new Map(rows.map((r) => [r.userId, r] as const))),
    [container, rows, names],
  );
  const named = users.map((u) => u.name).filter((n): n is string => !!n);
  const rest = users.length - named.length;

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm leading-[21px] font-semibold text-foreground">Users</span>
        <Link
          href="/inventory/user-containers"
          className="text-[13px] leading-[19px] font-semibold text-wz-link hover:underline"
        >
          Manage in User locations
        </Link>
      </div>
      <p className="text-sm leading-4 text-foreground">
        {users.length === 0
          ? "Nobody works from this van yet."
          : [...named, ...(rest ? [`${rest} other${rest === 1 ? "" : "s"}`] : [])].join(", ")}
      </p>
    </div>
  );
}
