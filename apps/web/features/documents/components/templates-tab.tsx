"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Copy, Plus, Star, Trash2 } from "lucide-react";
import type { DocumentTemplateSummary } from "@bitcrm/types";
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
import { WzButton } from "@/components/workiz/button";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzSettingsBar } from "@/components/workiz/settings-page";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useDeleteTemplate, useDocumentTemplates, useDuplicateTemplate, useSetDefaultTemplate } from "../hooks";
import { KIND_LABELS, autoApplySummary, groupTemplatesByKind, kindHasDefault } from "../lib";
import { NewTemplateDialog } from "./new-template-dialog";

const editorHref = (t: DocumentTemplateSummary) => `/settings/documents/${t.id}`;

/**
 * Workiz's row icons (IconButton-module small: 24×24, r4) — its trash and its
 * copy, and our star for "Set as default" beside them.
 */
function RowIcon({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-foreground outline-none hover:bg-wz-secondary-hover focus-visible:ring-2 focus-visible:ring-wz-focus [&_svg]:size-[18px] [&_svg]:stroke-[1.5]"
    >
      {children}
    </button>
  );
}

/**
 * The templates as Workiz's Document templates grid (pg_settings_general_wz_documents):
 * the yellow add button alone at the left, the strip (Search, page size),
 * one row per template — the name (16.8px ink, a link to the editor), then
 * ours: its type, Default, what it auto-applies to — and the row icons at
 * the right: set as default, delete (not on a default, as Workiz shows no
 * trash on its system documents), duplicate. Invoices, then estimates, then
 * custom documents, the default of each first.
 */
export function TemplatesTab({ canEdit, permsLoading = false }: { canEdit: boolean; permsLoading?: boolean }) {
  const router = useRouter();
  const listQuery = useDocumentTemplates();
  const { data, isError, error, refetch } = listQuery;
  const jobTypesQuery = useJobTypes();
  const serviceAreasQuery = useServiceAreas();
  const companiesQuery = useBusinessProfiles();
  const jobTypes = jobTypesQuery.data;
  const serviceAreas = serviceAreasQuery.data;
  const companies = companiesQuery.data;
  const duplicate = useDuplicateTemplate();
  const setDefault = useSetDefaultTemplate();
  const del = useDeleteTemplate();

  const [newOpen, setNewOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentTemplateSummary | null>(null);

  const templates = useMemo(() => data ?? [], [data]);

  // One skeleton until the rows can come whole: the buttons that need the
  // permissions, and the job types, areas and companies the "Auto-applies
  // to" cells name.
  const ready = usePageReady(
    !permsLoading && [listQuery, jobTypesQuery, serviceAreasQuery, companiesQuery].every(settled),
  );
  const rows = useMemo(() => groupTemplatesByKind(templates).flatMap((g) => g.templates), [templates]);
  const names = useMemo(
    () => ({
      jobTypes: new Map((jobTypes ?? []).map((j) => [j.id, j.name])),
      serviceAreas: new Map((serviceAreas ?? []).map((s) => [s.id, s.name])),
      companies: new Map((companies ?? []).map((c) => [c.id, c.name])),
    }),
    [jobTypes, serviceAreas, companies],
  );

  const columns = useMemo<WzGridColumn<DocumentTemplateSummary>[]>(() => {
    const applies = (t: DocumentTemplateSummary) =>
      kindHasDefault(t.kind) ? (autoApplySummary(t.autoApply, names)?.replace(/^Auto-applies to /, "") ?? "") : "";
    const cols: WzGridColumn<DocumentTemplateSummary>[] = [
      {
        id: "name",
        label: "Name",
        render: (t) => (
          <Link
            href={editorHref(t)}
            onClick={(e) => e.stopPropagation()}
            className="text-[16.8px] leading-4 text-foreground outline-none hover:underline focus-visible:underline"
          >
            {t.name}
          </Link>
        ),
        sortValue: (t) => t.name,
        searchText: (t) => t.name,
      },
      {
        id: "kind",
        label: "Type",
        width: 190,
        render: (t) => KIND_LABELS[t.kind].singular,
        sortValue: (t) => KIND_LABELS[t.kind].singular,
        searchText: (t) => KIND_LABELS[t.kind].singular,
      },
      {
        id: "default",
        label: "Default",
        width: 120,
        render: (t) => (t.isDefault ? <span className="font-semibold">Default</span> : ""),
      },
      { id: "applies", label: "Auto-applies to", render: applies, searchText: applies },
    ];
    if (canEdit) {
      cols.push({
        id: "actions",
        label: "",
        width: 130,
        render: (t) => (
          // The 24px icons in the 20px padding make Workiz's 64px row.
          <div className="flex items-center justify-end gap-2">
            {kindHasDefault(t.kind) && !t.isDefault ? (
              <RowIcon label={`Set ${t.name} as default`} onClick={() => setDefault.mutate(t.id)}>
                <Star />
              </RowIcon>
            ) : null}
            {!t.isDefault ? (
              <RowIcon label={`Delete ${t.name}`} onClick={() => setDeleting(t)}>
                <Trash2 />
              </RowIcon>
            ) : null}
            <RowIcon label={`Duplicate ${t.name}`} onClick={() => duplicate.mutate(t.id)}>
              <Copy />
            </RowIcon>
          </div>
        ),
      });
    }
    return cols;
  }, [canEdit, names, setDefault, duplicate]);

  if (!ready) {
    return (
      <div className="px-5 pt-5">
        <Skeleton className="h-[480px] w-full rounded-none" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="m-5 flex flex-col items-center gap-2 border border-wz-frame p-8 text-center">
        <AlertCircle className="size-6 text-wz-danger" />
        <p className="text-sm">{getApiErrorMessage(error, "Couldn't load templates")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <>
      <WzSettingsBar
        className="pb-7"
        action={
          canEdit ? (
            <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={() => setNewOpen(true)}>
              Add New Template
            </WzButton>
          ) : null
        }
      />
      <WzLocalGrid<DocumentTemplateSummary>
        label="Document templates"
        columns={columns}
        rows={rows}
        rowKey={(t) => t.id}
        onRowClick={(t, e) => {
          if (e.metaKey || e.ctrlKey) window.open(editorHref(t), "_blank");
          else router.push(editorHref(t));
        }}
        rowClassName="[&>td]:align-middle"
        pagerInside
      />

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} initialKind="invoice" templates={templates} />

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
    </>
  );
}
