"use client";

import { useMemo, useState } from "react";
import { Loader2, Megaphone, Trash2 } from "lucide-react";
import type { JobSource } from "@bitcrm/types";
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
import { useJobSources, useDeleteJobSource, useUpdateJobSource } from "../hooks";
import { JobSourceFormDialog } from "./job-source-form-dialog";

const byCatalogOrder = (a: JobSource, b: JobSource) => b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * Settings → Job Sources, as Workiz's Ad groups page
 * (pg_settings_catalogs_wz_adgroups): the band, "Show: Active" with "Add
 * New", the grid — Source Name, Priority, the ON/OFF Status — a row opening
 * its edit. Workiz's Description column is left out (a source here has
 * none); Delete is ours, in Workiz's Sub Status way.
 */
export function JobSourcesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const jobSourcesQuery = useJobSources();
  const jobSources = jobSourcesQuery.data;
  // One skeleton until both the user and the list are in: the "Add New"
  // button and the rows come in the same frame, and nobody is refused for
  // the beat their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(jobSourcesQuery));
  const del = useDeleteJobSource();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<JobSource | undefined>();
  const [deleting, setDeleting] = useState<JobSource | undefined>();

  const canCreate = can("job_sources", "create");
  const canEdit = can("job_sources", "edit");
  const canDelete = can("job_sources", "delete");

  const rows = useMemo(() => [...(jobSources ?? [])].sort(byCatalogOrder), [jobSources]);
  const columns = useMemo<WzGridColumn<JobSource>[]>(() => {
    const cols: WzGridColumn<JobSource>[] = [
      { id: "name", label: "Source Name", render: (s) => s.name, sortValue: (s) => s.name, searchText: (s) => s.name },
      { id: "priority", label: "Priority", render: (s) => s.priority, sortValue: (s) => s.priority, searchText: (s) => String(s.priority) },
      {
        id: "status",
        label: "Status",
        render: (s) => <JobSourceStatusSwitch jobSource={s} disabled={!canEdit} />,
        sortValue: (s) => (s.active ? 1 : 0),
      },
    ];
    if (canDelete) {
      cols.push({
        id: "actions",
        label: "Actions",
        render: (s) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${s.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(s);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, canDelete]);

  if (!permsLoading && !can("job_sources", "view")) {
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
    <WzSettingsCatalog<JobSource>
      icon={<Megaphone />}
      title="Job Sources"
      description="Find out what's working for your business with job sources."
      label="Job sources"
      ready={ready}
      rows={rows}
      rowKey={(s) => s.id}
      columns={columns}
      isActive={(s) => s.active}
      defaultSort={{ id: "priority", dir: "desc" }}
      onAdd={canCreate ? openNew : undefined}
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(s) => `Edit ${s.name}`}
    >
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

/** The row's Status switch: off archives the source, on brings it back. */
function JobSourceStatusSwitch({ jobSource, disabled }: { jobSource: JobSource; disabled: boolean }) {
  const update = useUpdateJobSource(jobSource.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${jobSource.name} status`}
      checked={pending ?? jobSource.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
