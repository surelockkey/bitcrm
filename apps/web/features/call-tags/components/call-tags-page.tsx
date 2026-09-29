"use client";

import { useState } from "react";
import { Pencil, Plus, RotateCcw, Tags, Trash2 } from "lucide-react";
import type { CallTag } from "@bitcrm/types";
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
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useArchiveCallTag, useCallTags, useRestoreCallTag } from "../hooks";
import { tagColorClasses } from "../lib";
import { CallTagFormDialog } from "./call-tag-form-dialog";

/**
 * Settings → Call Tags: the catalog behind the "Tags" column on the call log
 * (the Workiz call tags — SPAM CALLER, Tech Call, WRONG NUMBER…). Archived
 * tags stay listed, because the calls that carry them are still in the log.
 */
export function CallTagsPage() {
  const { can } = usePermissions();
  const canView = can("settings");
  const canEdit = can("settings", "edit");
  const { data: callTags, isLoading } = useCallTags(canView);
  const archive = useArchiveCallTag();
  const restore = useRestoreCallTag();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CallTag | undefined>();
  const [archiving, setArchiving] = useState<CallTag | undefined>();

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view telephony settings.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (callTag: CallTag) => {
    setEditing(callTag);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Call tags</h2>
          <p className="text-sm text-muted-foreground">
            Colored labels for calls — spam, wrong number, a tech calling in. A
            call can carry many, and the call log filters on them.
          </p>
        </div>
        {canEdit ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New call tag
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !callTags || callTags.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Tags className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No call tags yet</p>
          <p className="text-sm text-muted-foreground">
            Create tags so the team can mark spam, wrong numbers and tech calls
            — then filter the log by them.
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
              {callTags.map((callTag) => (
                <TableRow key={callTag.id}>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-chip border px-2.5 py-0.5 text-xs font-medium",
                        tagColorClasses(callTag.color),
                        !callTag.active && "opacity-60",
                      )}
                    >
                      {callTag.name}
                    </span>
                  </TableCell>
                  <TableCell>{callTag.priority}</TableCell>
                  <TableCell>
                    <Badge variant={callTag.active ? "default" : "secondary"}>
                      {callTag.active ? "Active" : "Archived"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(callTag)}
                          aria-label={`Edit ${callTag.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canEdit && callTag.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setArchiving(callTag)}
                          aria-label={`Archive ${callTag.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                      {canEdit && !callTag.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={restore.isPending}
                          onClick={() => restore.mutate(callTag.id)}
                          aria-label={`Restore ${callTag.name}`}
                        >
                          <RotateCcw className="size-4" />
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
        <CallTagFormDialog
          key={editing?.id ?? "new"}
          callTag={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive call tag?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{archiving?.name}&rdquo; leaves every picker. Calls already
              tagged with it keep their label — a call tag is never deleted, so
              the history stays readable. You can restore it from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiving) {
                  archive.mutate(archiving.id, {
                    onSuccess: () => setArchiving(undefined),
                  });
                }
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
