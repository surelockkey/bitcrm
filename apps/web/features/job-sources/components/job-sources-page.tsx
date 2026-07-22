"use client";

import { useState } from "react";
import { Loader2, Megaphone, Pencil, Plus, Trash2 } from "lucide-react";
import type { JobSource } from "@bitcrm/types";
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
import { useJobSources, useDeleteJobSource } from "../hooks";
import { JobSourceFormDialog } from "./job-source-form-dialog";

export function JobSourcesPage() {
  const { can } = usePermissions();
  const { data: jobSources, isLoading } = useJobSources();
  const del = useDeleteJobSource();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobSource | undefined>();
  const [deleting, setDeleting] = useState<JobSource | undefined>();

  const canCreate = can("job_sources", "create");
  const canEdit = can("job_sources", "edit");
  const canDelete = can("job_sources", "delete");

  if (!can("job_sources", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view job sources.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (jobSource: JobSource) => {
    setEditing(jobSource);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Job sources</h2>
          <p className="text-sm text-muted-foreground">
            Where your deals come from. A deal picks one when it&apos;s created.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New job source
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !jobSources || jobSources.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Megaphone className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No job sources yet</p>
          <p className="text-sm text-muted-foreground">
            Add your lead sources so deals can record where they came from.
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
              {jobSources.map((jobSource) => (
                <TableRow key={jobSource.id}>
                  <TableCell className="font-medium">{jobSource.name}</TableCell>
                  <TableCell>{jobSource.priority}</TableCell>
                  <TableCell>
                    <Badge variant={jobSource.active ? "default" : "secondary"}>
                      {jobSource.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(jobSource)} aria-label="Edit">
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(jobSource)} aria-label="Delete">
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
        <JobSourceFormDialog
          key={editing?.id ?? "new"}
          jobSource={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job source?</AlertDialogTitle>
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
