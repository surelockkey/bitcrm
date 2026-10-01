"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Info, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { DialogLoadingBody } from "@/features/inventory/components/dialog-loading";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContainer, useUpdateContainer } from "../hooks";
import type { UpdateContainerBody } from "../api";
import { containerSchema } from "../schemas";
import Link from "next/link";
import { TemplateSelect } from "@/features/inventory/templates/components/template-select";
import { useUserContainers, useUserNames } from "@/features/inventory/user-containers/hooks";
import {
  containerUserNames,
  unnamedUserIds,
  usersOfContainer,
} from "@/features/inventory/user-containers/lib";

/**
 * The van's Edit popup — Inventory has no container page any more. Opened
 * from the row's pencil or a link to the van; view-only without `containers.edit`.
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

  let content: ReactNode;
  if (query.isLoading) {
    content = (
      <>
        <Header title={canEdit ? "Edit container" : "Container"} />
        <DialogLoadingBody
          testId="container-edit-loading"
          fields={["input", "area", "input", "input", "input", "switch"]}
        />
      </>
    );
  } else if (query.isError || !query.data) {
    content = (
      <>
        <Header title="Container not found" description="It may have been deleted." />
        <DialogFooter className="m-0 flex-none">
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </>
    );
  } else {
    // Keyed by the save time: a fresh copy of the van starts a fresh form.
    content = (
      <ContainerForm key={query.data.updatedAt} container={query.data} readOnly={!canEdit} onClose={close} />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        {content}
      </DialogContent>
    </Dialog>
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
      className="flex min-h-0 flex-1 flex-col"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) save();
      }}
    >
      <Header title={readOnly ? "Container" : "Edit container"} />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {readOnly ? (
          <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            <Info className="size-4" />
            You have view-only access to containers.
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="c-name">Name</Label>
          <Input
            id="c-name"
            className="h-10"
            disabled={readOnly}
            value={name}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c-desc">Description</Label>
          <Textarea
            id="c-desc"
            rows={3}
            disabled={readOnly}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c-department">Department</Label>
          <Input
            id="c-department"
            className="h-10"
            disabled={readOnly}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="c-template">Template</Label>
          <TemplateSelect id="c-template" value={templateId} onChange={setTemplateId} disabled={readOnly} />
          <p className="text-sm text-muted-foreground">The van&apos;s ideal loadout.</p>
        </div>

        <VanUsers container={container} />

        <div className="flex items-center justify-between rounded-lg border px-4 py-3">
          <div>
            <Label htmlFor="c-active">Active</Label>
            <p className="text-sm text-muted-foreground">Inactive vans are hidden from transfer pickers.</p>
          </div>
          <Switch id="c-active" disabled={readOnly} checked={active} onCheckedChange={setActive} />
        </div>
      </div>

      <DialogFooter className="m-0 flex-none">
        {readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending} className="gap-1.5">
              {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}

/**
 * Who works from the van — read-only here. Several people may share a van,
 * and reassigning is done on User containers.
 */
function VanUsers({ container }: { container: Container }) {
  const assignments = useUserContainers();
  const rows = useMemo(() => assignments.data ?? [], [assignments.data]);
  const { names } = useUserNames(useMemo(() => unnamedUserIds(rows), [rows]));
  const users = useMemo(
    () =>
      usersOfContainer(
        container,
        containerUserNames(rows, names),
        new Map(rows.map((r) => [r.userId, r] as const)),
      ),
    [container, rows, names],
  );
  const named = users.map((u) => u.name).filter((n): n is string => !!n);
  const rest = users.length - named.length;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">Users</span>
        <Link href="/inventory/user-containers" className="text-sm text-brand underline-offset-4 hover:underline">
          Manage in User containers
        </Link>
      </div>
      <p className="text-sm text-muted-foreground">
        {users.length === 0
          ? "Nobody works from this van yet."
          : [...named, ...(rest ? [`${rest} other${rest === 1 ? "" : "s"}`] : [])].join(", ")}
      </p>
    </div>
  );
}

function Header({ title, description }: { title: string; description?: string }) {
  return (
    // Right padding keeps the title clear of the close button.
    <DialogHeader className="border-b px-4 py-3 pr-12">
      <DialogTitle className="text-base">{title}</DialogTitle>
      <DialogDescription className={description ? undefined : "sr-only"}>
        {description ?? "The van's name, department, template and status."}
      </DialogDescription>
    </DialogHeader>
  );
}
