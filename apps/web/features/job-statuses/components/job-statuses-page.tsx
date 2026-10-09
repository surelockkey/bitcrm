"use client";

import { useMemo, useState } from "react";
import { Loader2, Tag, Trash2 } from "lucide-react";
import type { DealSubStatus } from "@bitcrm/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzButton } from "@/components/workiz/button";
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsCatalog } from "@/components/workiz/settings-catalog";
import { WzColorBar } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useJobStatuses, useDeleteJobStatus, useUpdateJobStatus } from "../hooks";
import { STATUS_SWATCH_CLASSES, groupJobStatuses } from "../lib";
import { JobStatusFormDialog } from "./job-status-form-dialog";

/**
 * Settings → Job Statuses, as Workiz's Sub Status page (uikit_wz_set_substatus,
 * pg_settings_catalogs_wz_substatus): the band, "Add New" at the left, the
 * grid at 50 a page — Sub Name, Sub Parent (the super-status), Color (the
 * 100×16 bar), Actions (Delete). The ON/OFF Status column is ours (a status
 * here can be archived; Workiz's cannot), in its Job Types look. A row opens
 * "Edit Sub status".
 */
export function JobStatusesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const statusesQuery = useJobStatuses();
  const statuses = statusesQuery.data;
  // One skeleton until both the user and the list are in: "Add New" and the
  // rows come in one frame, and nobody is refused for the beat their
  // permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(statusesQuery));
  const del = useDeleteJobStatus();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DealSubStatus | undefined>();
  const [deleting, setDeleting] = useState<DealSubStatus | undefined>();

  const canCreate = can("job_statuses", "create");
  const canEdit = can("job_statuses", "edit");
  const canDelete = can("job_statuses", "delete");

  // Pipeline order — the super-statuses in turn, each one's statuses in the
  // catalog's order — with the parent's name alongside.
  const rows = useMemo(
    () =>
      groupJobStatuses(statuses).flatMap(({ label, statuses: list }) =>
        list.map((status) => ({ status, parent: label })),
      ),
    [statuses],
  );
  type Row = (typeof rows)[number];

  const columns = useMemo<WzGridColumn<Row>[]>(() => {
    const cols: WzGridColumn<Row>[] = [
      { id: "name", label: "Sub Name", render: (r) => r.status.name, sortValue: (r) => r.status.name, searchText: (r) => r.status.name },
      { id: "parent", label: "Sub Parent", render: (r) => r.parent, sortValue: (r) => r.parent, searchText: (r) => r.parent },
      {
        id: "color",
        label: "Color",
        width: 200,
        render: (r) => <WzColorBar className={STATUS_SWATCH_CLASSES[r.status.color]} label={r.status.color} />,
      },
      {
        id: "status",
        label: "Status",
        render: (r) => <JobStatusSwitch status={r.status} disabled={!canEdit} />,
        sortValue: (r) => (r.status.active ? 1 : 0),
      },
    ];
    if (canDelete) {
      cols.push({
        id: "actions",
        label: "Actions",
        render: (r) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${r.status.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(r.status);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, canDelete]);

  if (!permsLoading && !can("job_statuses", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view job statuses.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (row: Row) => {
    setEditing(row.status);
    setFormOpen(true);
  };

  return (
    <WzSettingsCatalog<Row>
      icon={<Tag />}
      title="Job Statuses"
      description="Manage different stages of your work flow and filter your schedule with sub statuses."
      label="Job statuses"
      ready={ready}
      rows={rows}
      rowKey={(r) => r.status.id}
      columns={columns}
      defaultPageSize={50}
      onAdd={canCreate ? openNew : undefined}
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(r) => `Edit ${r.status.name}`}
    >
      {formOpen ? (
        <JobStatusFormDialog
          key={editing?.id ?? "new"}
          status={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job status?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any job still uses it, it&apos;s
              archived instead — it leaves the pickers but old jobs keep their label.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) del.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              {del.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WzSettingsCatalog>
  );
}

/** The row's Status switch: off archives the status, on brings it back. */
function JobStatusSwitch({ status, disabled }: { status: DealSubStatus; disabled: boolean }) {
  const update = useUpdateJobStatus(status.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${status.name} status`}
      checked={pending ?? status.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
