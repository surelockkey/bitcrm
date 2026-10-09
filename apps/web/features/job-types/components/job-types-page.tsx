"use client";

import { useMemo, useState } from "react";
import { Loader2, Trash2, Wrench } from "lucide-react";
import type { JobType } from "@bitcrm/types";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useJobTypes, useDeleteJobType, useUpdateJobType } from "../hooks";
import { formatJobTypeDuration, jobTypeDurationMinutes } from "../lib";
import { JobTypeFormDialog } from "./job-type-form-dialog";

/** The catalog order: priority first (higher first), then the name. */
const byCatalogOrder = (a: JobType, b: JobType) => b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * Settings → Job Types, as Workiz's (uikit_wz_set_jobtypes): the band, "Show:
 * Active" with "Add New", the grid — Type Name, Priority, Duration ("2 hours",
 * Workiz's words), the ON/OFF Status switch — a row opening "Edit Job Type".
 * Delete is ours, in Workiz's Sub Status way (a yellow pill in Actions).
 */
export function JobTypesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const jobTypesQuery = useJobTypes();
  const jobTypes = jobTypesQuery.data;
  const del = useDeleteJobType();
  // One skeleton until both the user and the list are in: the "Add New"
  // button and the rows come in the same frame, and nobody is refused for
  // the beat their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(jobTypesQuery));

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobType | undefined>();
  const [deleting, setDeleting] = useState<JobType | undefined>();

  const canCreate = can("job_types", "create");
  const canEdit = can("job_types", "edit");
  const canDelete = can("job_types", "delete");

  const rows = useMemo(() => [...(jobTypes ?? [])].sort(byCatalogOrder), [jobTypes]);
  const columns = useMemo<WzGridColumn<JobType>[]>(() => {
    const cols: WzGridColumn<JobType>[] = [
      { id: "name", label: "Type Name", render: (t) => t.name, sortValue: (t) => t.name, searchText: (t) => t.name },
      { id: "priority", label: "Priority", render: (t) => t.priority, sortValue: (t) => t.priority, searchText: (t) => String(t.priority) },
      {
        id: "duration",
        label: "Duration",
        render: (t) => formatJobTypeDuration(t.durationMinutes),
        sortValue: (t) => jobTypeDurationMinutes(t),
      },
      {
        id: "status",
        label: "Status",
        render: (t) => <JobTypeStatusSwitch jobType={t} disabled={!canEdit} />,
        sortValue: (t) => (t.active ? 1 : 0),
      },
    ];
    if (canDelete) {
      cols.push({
        id: "actions",
        label: "Actions",
        render: (t) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${t.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(t);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, canDelete]);

  if (!permsLoading && !can("job_types", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view job types.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (jobType: JobType) => {
    setEditing(jobType);
    setFormOpen(true);
  };

  return (
    <WzSettingsCatalog<JobType>
      icon={<Wrench />}
      title="Job Types"
      description="Add your job types and assign to jobs."
      label="Job types"
      ready={ready}
      rows={rows}
      rowKey={(t) => t.id}
      columns={columns}
      isActive={(t) => t.active}
      defaultSort={{ id: "priority", dir: "desc" }}
      onAdd={canCreate ? openNew : undefined}
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(t) => `Edit ${t.name}`}
    >
      {formOpen ? (
        <JobTypeFormDialog
          key={editing?.id ?? "new"}
          jobType={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job type?</AlertDialogTitle>
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

/**
 * The row's Status switch: switching a type off archives it (it leaves the
 * pickers, old jobs keep it), on brings it back. It shows the state asked
 * for while the save is on its way, as Workiz's flips at once.
 */
function JobTypeStatusSwitch({ jobType, disabled }: { jobType: JobType; disabled: boolean }) {
  const update = useUpdateJobType(jobType.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${jobType.name} status`}
      checked={pending ?? jobType.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
