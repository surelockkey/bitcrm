"use client";

import { useState } from "react";
import { Loader2, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import type { JobSuperStatus, DealSubStatus } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { useJobStatuses, useDeleteJobStatus } from "../hooks";
import { groupJobStatuses, statusColorClasses } from "../lib";
import { JobStatusFormDialog } from "./job-status-form-dialog";

export function JobStatusesPage() {
  const { can } = usePermissions();
  const { data: statuses, isLoading } = useJobStatuses();
  const del = useDeleteJobStatus();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DealSubStatus | undefined>();
  const [addGroup, setAddGroup] = useState<JobSuperStatus | undefined>();
  const [deleting, setDeleting] = useState<DealSubStatus | undefined>();

  const canCreate = can("job_statuses", "create");
  const canEdit = can("job_statuses", "edit");
  const canDelete = can("job_statuses", "delete");

  if (!can("job_statuses", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view job statuses.
        </p>
      </div>
    );
  }

  const openNew = (group: JobSuperStatus) => {
    setEditing(undefined);
    setAddGroup(group);
    setFormOpen(true);
  };
  const openEdit = (status: DealSubStatus) => {
    setEditing(status);
    setAddGroup(undefined);
    setFormOpen(true);
  };

  // Always show every super-status so a status can be added under any of them.
  const groups = groupJobStatuses(statuses, { includeEmpty: true });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">Job statuses</h2>
        <p className="text-sm text-muted-foreground">
          Custom colored statuses filed under a super-status. A job carries one at a time; the
          super-status maps to the pipeline stage group.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(({ group, label, statuses: rows }) => (
            <div key={group} className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
                <h3 className="text-sm font-semibold">{label}</h3>
                {canCreate ? (
                  <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => openNew(group)}>
                    <Plus className="size-4" /> Add status
                  </Button>
                ) : null}
              </div>

              {rows.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">
                  No statuses under {label} yet.
                </p>
              ) : (
                <ul className="divide-y">
                  {rows.map((status) => (
                    <li key={status.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          statusColorClasses(status.color),
                        )}
                      >
                        {status.name}
                      </span>
                      {!status.active ? (
                        <Badge variant="secondary" className="text-[10px]">Archived</Badge>
                      ) : null}
                      <span className="ml-auto text-xs text-muted-foreground">Priority {status.priority}</span>
                      <div className="flex gap-1">
                        {canEdit ? (
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(status)} aria-label="Edit">
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                        {canDelete ? (
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(status)} aria-label="Delete">
                            <Trash2 className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          {groups.every((g) => g.statuses.length === 0) && !canCreate ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
              <ListChecks className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">No job statuses yet</p>
            </div>
          ) : null}
        </div>
      )}

      {formOpen ? (
        <JobStatusFormDialog
          key={editing?.id ?? `new-${addGroup}`}
          status={editing}
          defaultGroup={addGroup}
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
    </div>
  );
}
