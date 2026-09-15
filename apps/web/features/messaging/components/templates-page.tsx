"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import type { MessageTemplate } from "@bitcrm/types";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeleteTemplate, useMessagingAccess, useTemplates, useUpdateTemplate } from "../hooks";
import { TemplateFormDialog } from "./template-form-dialog";

const CHANNEL_LABEL: Record<MessageTemplate["channel"], string> = {
  sms: "SMS",
  email: "Email",
  any: "SMS + email",
};

const snippet = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/** Settings → Message templates: the canned texts the composer offers. */
export function TemplatesPage() {
  const { canViewTemplates, canCreateTemplates, canEditTemplates, canDeleteTemplates } = useMessagingAccess();
  const { data: templates, isLoading } = useTemplates({ includeInactive: true }, canViewTemplates);
  const update = useUpdateTemplate();
  const del = useDeleteTemplate();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | undefined>();
  const [deleting, setDeleting] = useState<MessageTemplate | undefined>();

  if (!canViewTemplates) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view message templates.</p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (t: MessageTemplate) => {
    setEditing(t);
    setFormOpen(true);
  };
  const sorted = [...(templates ?? [])].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.messageTemplateTitle.localeCompare(b.messageTemplateTitle),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Message templates</h2>
          <p className="text-sm text-muted-foreground">
            Canned texts with short codes. The composer offers the active ones; archived stay resolvable in history.
          </p>
        </div>
        {canCreateTemplates ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New template
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <FileText className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No templates yet</p>
          <p className="text-sm text-muted-foreground">Write the texts your team sends every day, once.</p>
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead className="w-28">Channel</TableHead>
                <TableHead className="w-32">Category</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-28 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((t) => (
                <TableRow key={t.id} data-testid={`template-${t.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.messageTemplateTitle}</span>
                      {t.isDefault ? <Badge variant="outline">Default</Badge> : null}
                    </div>
                    <div className="max-w-md truncate text-xs text-muted-foreground">{snippet(t.messageTemplate)}</div>
                  </TableCell>
                  <TableCell className="text-sm">{CHANNEL_LABEL[t.channel]}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.category || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={t.active ? "default" : "secondary"}>{t.active ? "Active" : "Archived"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEditTemplates ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(t)} aria-label={`Edit ${t.messageTemplateTitle}`}>
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canEditTemplates && !t.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => update.mutate({ id: t.id, body: { active: true } })}
                          aria-label={`Restore ${t.messageTemplateTitle}`}
                        >
                          <ArchiveRestore className="size-4" />
                        </Button>
                      ) : null}
                      {canDeleteTemplates && t.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => del.mutate({ id: t.id })}
                          aria-label={`Archive ${t.messageTemplateTitle}`}
                        >
                          <Archive className="size-4" />
                        </Button>
                      ) : null}
                      {canDeleteTemplates && !t.active ? (
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => setDeleting(t)} aria-label={`Delete ${t.messageTemplateTitle}`}>
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
        <TemplateFormDialog key={editing?.id ?? "new"} template={editing} open={formOpen} onOpenChange={setFormOpen} />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.messageTemplateTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanent. Messages sent from it keep their text but no longer name the template.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) del.mutate({ id: deleting.id, permanent: true }, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
