"use client";

import { useMemo, useState } from "react";
import { Loader2, Tags, Trash2 } from "lucide-react";
import type { ClientTag } from "@bitcrm/types";
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
import { WzColorBar } from "@/components/workiz/settings-page";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useClientTags, useDeleteClientTag, useUpdateClientTag } from "../hooks";
import { TAG_SWATCH_CLASSES } from "../lib";
import { ClientTagFormDialog } from "./client-tag-form-dialog";

const byCatalogOrder = (a: ClientTag, b: ClientTag) => b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * Settings → Client Tags. Workiz has no tags settings page (its client tags
 * are made from the client card), so this follows its nearest pages: Sub
 * Status's grid (Tag Name, the Color bar, Actions with the yellow Delete)
 * and Job Types' "Show: Active" with the ON/OFF Status switch. A row opens
 * the tag's edit.
 */
export function ClientTagsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const tagsQuery = useClientTags();
  const clientTags = tagsQuery.data;
  // One skeleton until both the user and the list are in: "Add New" and the
  // rows come in the same frame, and nobody is refused for the beat their
  // permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(tagsQuery));
  const del = useDeleteClientTag();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ClientTag | undefined>();
  const [deleting, setDeleting] = useState<ClientTag | undefined>();

  const canCreate = can("client_tags", "create");
  const canEdit = can("client_tags", "edit");
  const canDelete = can("client_tags", "delete");

  const rows = useMemo(() => [...(clientTags ?? [])].sort(byCatalogOrder), [clientTags]);
  const columns = useMemo<WzGridColumn<ClientTag>[]>(() => {
    const cols: WzGridColumn<ClientTag>[] = [
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
        render: (t) => <ClientTagStatusSwitch tag={t} disabled={!canEdit} />,
        sortValue: (t) => (t.active ? 1 : 0),
      },
    ];
    if (canDelete) {
      cols.push({
        id: "actions",
        label: "Actions",
        render: (t) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${t.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(t);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, canDelete]);

  // Refused only once the permissions say so — not while they are on their way.
  if (denied("client_tags", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view client tags.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (clientTag: ClientTag) => {
    setEditing(clientTag);
    setFormOpen(true);
  };

  return (
    <WzSettingsCatalog<ClientTag>
      icon={<Tags />}
      title="Client Tags"
      description="Colored labels for your clients, as PLATINUM or tax free. Added from the client card."
      label="Client tags"
      ready={ready}
      rows={rows}
      rowKey={(t) => t.id}
      columns={columns}
      isActive={(t) => t.active}
      defaultSort={{ id: "priority", dir: "desc" }}
      onAdd={canCreate ? openNew : undefined}
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(t) => `Edit ${t.name}`}
    >
      {formOpen ? (
        <ClientTagFormDialog
          key={editing?.id ?? "new"}
          clientTag={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete client tag?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any client still carries it, it&apos;s
              archived instead — it leaves the pickers but those clients keep their label.
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

/** The row's Status switch: off archives the tag, on brings it back. */
function ClientTagStatusSwitch({ tag, disabled }: { tag: ClientTag; disabled: boolean }) {
  const update = useUpdateClientTag(tag.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${tag.name} status`}
      checked={pending ?? tag.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
