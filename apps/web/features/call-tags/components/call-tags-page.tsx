"use client";

import { useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";
import type { CallTag } from "@bitcrm/types";
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
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsCatalog } from "@/components/workiz/settings-catalog";
import { WzColorBar } from "@/components/workiz/settings-page";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useArchiveCallTag, useCallTags, useRestoreCallTag } from "../hooks";
import { TAG_SWATCH_CLASSES } from "../lib";
import { CallTagFormDialog } from "./call-tag-form-dialog";

const byCatalogOrder = (a: CallTag, b: CallTag) => b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * Settings → Call Tags: the catalog behind the "Tags" column on the call log
 * (the Workiz call tags — SPAM CALLER, Tech Call, WRONG NUMBER…). Workiz
 * manages them from the call, with no settings page, so this follows its
 * Sub Status page (the Color bar) with Job Types' ON/OFF Status switch. A
 * call tag is never deleted: switching one off archives it (after a
 * confirm), on restores it. Archived tags stay listed — "Show: All" from the
 * start — because the calls that carry them are still in the log.
 */
export function CallTagsPage() {
  const { can, isLoading: permissionsLoading } = usePermissions();
  const denied = useDenied();
  const canView = can("settings");
  const canEdit = can("settings", "edit");
  const callTagsQuery = useCallTags(canView);
  const { data: callTags } = callTagsQuery;
  const ready = usePageReady(!permissionsLoading && settled(callTagsQuery));
  const archive = useArchiveCallTag();
  const restore = useRestoreCallTag();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CallTag | undefined>();
  const [archiving, setArchiving] = useState<CallTag | undefined>();

  const rows = useMemo(() => [...(callTags ?? [])].sort(byCatalogOrder), [callTags]);
  const columns = useMemo<WzGridColumn<CallTag>[]>(
    () => [
      { id: "name", label: "Tag Name", render: (t) => t.name, sortValue: (t) => t.name, searchText: (t) => t.name },
      {
        id: "color",
        label: "Color",
        width: 200,
        render: (t) => <WzColorBar className={TAG_SWATCH_CLASSES[t.color]} label={t.color} />,
      },
      { id: "priority", label: "Priority", render: (t) => t.priority, sortValue: (t) => t.priority, searchText: (t) => String(t.priority) },
      {
        id: "status",
        label: "Status",
        sortValue: (t) => (t.active ? 1 : 0),
        render: (t) => (
          <WzOnOffSwitch
            aria-label={`${t.name} status`}
            checked={t.active}
            disabled={!canEdit || restore.isPending}
            onCheckedChange={(on) => (on ? restore.mutate(t.id) : setArchiving(t))}
          />
        ),
      },
    ],
    [canEdit, restore],
  );

  // Refused only once the permissions say so — not while they are coming.
  if (denied("settings")) {
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
    <WzSettingsCatalog<CallTag>
      icon={<PhoneCall />}
      title="Call Tags"
      description="Colored labels for calls — spam, wrong number, a tech calling in. The call log filters on them."
      label="Call tags"
      ready={ready}
      rows={rows}
      rowKey={(t) => t.id}
      columns={columns}
      isActive={(t) => t.active}
      defaultShow="all"
      defaultSort={{ id: "priority", dir: "desc" }}
      onAdd={canEdit ? openNew : undefined}
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(t) => `Edit ${t.name}`}
    >
      {formOpen ? (
        <CallTagFormDialog
          key={editing?.id ?? "new"}
          callTag={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(archiving)} onOpenChange={(v) => !v && setArchiving(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive call tag?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{archiving?.name}&rdquo; leaves every picker. Calls already
              tagged with it keep their label — a call tag is never deleted, so
              the history stays readable. Switch it back on here to restore it.
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
    </WzSettingsCatalog>
  );
}
