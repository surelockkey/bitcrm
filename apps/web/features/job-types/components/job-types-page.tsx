"use client";

import { useState } from "react";
import { Loader2, Wrench, Pencil, Plus, Trash2 } from "lucide-react";
import type { JobType } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useJobTypes, useDeleteJobType } from "../hooks";
import { JobTypeFormDialog } from "./job-type-form-dialog";

export function JobTypesPage() {
  const { can } = usePermissions();
  const { data: jobTypes, isLoading } = useJobTypes();
  const del = useDeleteJobType();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobType | undefined>();
  const [deleting, setDeleting] = useState<JobType | undefined>();

  const canCreate = can("job_types", "create");
  const canEdit = can("job_types", "edit");
  const canDelete = can("job_types", "delete");

  if (!can("job_types", "view")) {
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Job types</h2>
          <p className="text-sm text-muted-foreground">
            The kinds of work you dispatch. Deals pick one; technicians are approved for them.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New job type
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !jobTypes || jobTypes.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Wrench className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No job types yet</p>
          <p className="text-sm text-muted-foreground">
            Create one so deals can be categorised and technicians approved for it.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobTypes.map((jobType) => (
                <TableRow key={jobType.id}>
                  <TableCell className="font-medium">{jobType.name}</TableCell>
                  <TableCell>{jobType.priority}</TableCell>
                  <TableCell>
                    <Badge variant={jobType.active ? "default" : "secondary"}>
                      {jobType.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(jobType)} aria-label="Edit">
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(jobType)} aria-label="Delete">
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

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
              &ldquo;{deleting?.name}&rdquo; will be removed. If any deal still uses it, it&apos;s
              archived instead — it leaves the pickers but old deals keep their label.
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
