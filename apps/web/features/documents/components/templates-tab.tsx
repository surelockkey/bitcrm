"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertCircle, FileText, Plus } from "lucide-react";
import type { DocumentTemplateKind, DocumentTemplateSummary } from "@bitcrm/types";
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
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useDeleteTemplate, useDocumentTemplates, useDuplicateTemplate, useSetDefaultTemplate } from "../hooks";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { KIND_LABELS, autoApplySummary, groupTemplatesByKind } from "../lib";
import { NewTemplateDialog } from "./new-template-dialog";
import { TemplateCard } from "./template-card";

export function TemplatesTab({ canEdit }: { canEdit: boolean }) {
  const { data, isLoading, isError, error, refetch } = useDocumentTemplates();
  const { data: jobTypes } = useJobTypes();
  const { data: serviceAreas } = useServiceAreas();
  const { data: companies } = useBusinessProfiles();
  const duplicate = useDuplicateTemplate();
  const setDefault = useSetDefaultTemplate();
  const del = useDeleteTemplate();

  const [newKind, setNewKind] = useState<DocumentTemplateKind | null>(null);
  const [deleting, setDeleting] = useState<DocumentTemplateSummary | null>(null);

  const templates = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupTemplatesByKind(templates), [templates]);
  const names = useMemo(
    () => ({
      jobTypes: new Map((jobTypes ?? []).map((j) => [j.id, j.name])),
      serviceAreas: new Map((serviceAreas ?? []).map((s) => [s.id, s.name])),
      companies: new Map((companies ?? []).map((c) => [c.id, c.name])),
    }),
    [jobTypes, serviceAreas, companies],
  );

  const onDuplicate = useCallback((t: DocumentTemplateSummary) => duplicate.mutate(t.id), [duplicate]);
  const onSetDefault = useCallback((t: DocumentTemplateSummary) => setDefault.mutate(t.id), [setDefault]);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm">{getApiErrorMessage(error, "Couldn't load templates")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          The layout of the PDFs you send. Each document type has a default; others can apply automatically by job type,
          service area or company.
        </p>
        {canEdit ? (
          <Button variant="brand" className="gap-1.5" onClick={() => setNewKind("invoice")}>
            <Plus /> New template
          </Button>
        ) : null}
      </div>

      {groups.map((g) => {
        const headingId = `doc-group-${g.kind}`;
        return (
          <section key={g.kind} aria-labelledby={headingId} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 id={headingId} className="text-sm font-semibold">
                {g.label}
              </h3>
              {canEdit ? (
                <Button variant="ghost" size="sm" className="gap-1" onClick={() => setNewKind(g.kind)}>
                  <Plus /> Add {KIND_LABELS[g.kind].singular.toLowerCase()} template
                </Button>
              ) : null}
            </div>
            {g.templates.length ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {g.templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    autoApply={g.kind === "custom" ? null : autoApplySummary(t.autoApply, names)}
                    canEdit={canEdit}
                    onDuplicate={onDuplicate}
                    onSetDefault={onSetDefault}
                    onDelete={setDeleting}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                <FileText className="size-5" />
                No {g.label.toLowerCase()} templates yet.
              </div>
            )}
          </section>
        );
      })}

      <NewTemplateDialog
        open={newKind !== null}
        onOpenChange={(o) => !o && setNewKind(null)}
        initialKind={newKind ?? "invoice"}
        templates={templates}
      />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Documents that used this template switch to the default template. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) del.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
