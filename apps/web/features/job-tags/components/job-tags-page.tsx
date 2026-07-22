"use client";

import { useState } from "react";
import { Loader2, Tags, Pencil, Plus, Trash2 } from "lucide-react";
import type { JobTag } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
import { useJobTags, useDeleteJobTag } from "../hooks";
import { tagColorClasses } from "../lib";
import { JobTagFormDialog } from "./job-tag-form-dialog";

export function JobTagsPage() {
  const { can } = usePermissions();
  const { data: jobTags, isLoading } = useJobTags();
  const del = useDeleteJobTag();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobTag | undefined>();
  const [deleting, setDeleting] = useState<JobTag | undefined>();

  const canCreate = can("job_tags", "create");
  const canEdit = can("job_tags", "edit");
  const canDelete = can("job_tags", "delete");

  if (!can("job_tags", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view job tags.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (jobTag: JobTag) => {
    setEditing(jobTag);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Job tags</h2>
          <p className="text-sm text-muted-foreground">
            Colored labels for deals. A deal can carry as many as you like.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New job tag
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !jobTags || jobTags.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Tags className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No job tags yet</p>
          <p className="text-sm text-muted-foreground">
            Create colored tags so deals can be labeled and filtered.
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
              {jobTags.map((jobTag) => (
                <TableRow key={jobTag.id}>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                        tagColorClasses(jobTag.color),
                      )}
                    >
                      {jobTag.name}
                    </span>
                  </TableCell>
                  <TableCell>{jobTag.priority}</TableCell>
                  <TableCell>
                    <Badge variant={jobTag.active ? "default" : "secondary"}>
                      {jobTag.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(jobTag)} aria-label="Edit">
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(jobTag)} aria-label="Delete">
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
        <JobTagFormDialog
          key={editing?.id ?? "new"}
          jobTag={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job tag?</AlertDialogTitle>
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
