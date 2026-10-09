"use client";

import { useMemo, useState } from "react";
import { Loader2, Map as MapIcon, Trash2 } from "lucide-react";
import type { ServiceArea } from "@bitcrm/types";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { serviceAreaTaxLabel } from "@/features/billing/lib";
import { useServiceAreas, useDeleteServiceArea, useUpdateServiceArea } from "../hooks";
import { describeArea } from "../lib";
import { ServiceAreaFormDialog } from "./service-area-form-dialog";

const byCatalogOrder = (a: ServiceArea, b: ServiceArea) => b.priority - a.priority || a.name.localeCompare(b.name);

/**
 * Settings → Service Areas, as Workiz's (uikit_wz_set_servicearea,
 * pg_settings_catalogs_wz_metroareas): the band, "Show: Active" with "Add
 * Service area", the grid — Name, Color Class (the colour bar across the
 * cell), the ON/OFF Status — a row opening the area. Definition, Sales tax
 * and Priority are ours, between them; Delete is ours, as Sub Status draws
 * it. Workiz's "Enabled" column is not (its meaning is Workiz's own).
 */
export function ServiceAreasPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const areasQuery = useServiceAreas();
  const areas = areasQuery.data;
  // One skeleton until both the user and the list are in: the add button and
  // the rows come in the same frame, and nobody is refused for the beat
  // their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(areasQuery));
  const del = useDeleteServiceArea();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceArea | undefined>();
  const [deleting, setDeleting] = useState<ServiceArea | undefined>();

  const canCreate = can("service_areas", "create");
  const canEdit = can("service_areas", "edit");
  const canDelete = can("service_areas", "delete");

  const rows = useMemo(() => [...(areas ?? [])].sort(byCatalogOrder), [areas]);
  const columns = useMemo<WzGridColumn<ServiceArea>[]>(() => {
    const cols: WzGridColumn<ServiceArea>[] = [
      { id: "name", label: "Name", render: (a) => a.name, sortValue: (a) => a.name, searchText: (a) => a.name },
      {
        id: "color",
        label: "Color Class",
        render: (a) => (a.color ? <WzColorBar color={a.color} label={a.color} width="full" /> : null),
      },
      { id: "definition", label: "Definition", render: (a) => describeArea(a), searchText: (a) => describeArea(a) },
      { id: "tax", label: "Sales tax", render: (a) => serviceAreaTaxLabel(a.tax), searchText: (a) => a.tax?.name },
      { id: "priority", label: "Priority", width: 120, render: (a) => a.priority, sortValue: (a) => a.priority },
      {
        id: "status",
        label: "Status",
        width: 150,
        render: (a) => <ServiceAreaStatusSwitch area={a} disabled={!canEdit} />,
        sortValue: (a) => (a.active ? 1 : 0),
      },
    ];
    if (canDelete) {
      cols.push({
        id: "actions",
        label: "Actions",
        width: 150,
        render: (a) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${a.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(a);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, canDelete]);

  if (!permsLoading && !can("service_areas", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view service areas.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (area: ServiceArea) => {
    setEditing(area);
    setFormOpen(true);
  };

  return (
    <WzSettingsCatalog<ServiceArea>
      icon={<MapIcon />}
      title="Service Areas"
      description="Divide your service areas to make team scheduling easy. Areas can't overlap."
      label="Service areas"
      ready={ready}
      rows={rows}
      rowKey={(a) => a.id}
      columns={columns}
      isActive={(a) => a.active}
      onAdd={canCreate ? openNew : undefined}
      addLabel="Add Service area"
      onOpen={canEdit ? openEdit : undefined}
      openLabel={(a) => `Edit ${a.name}`}
    >
      {formOpen ? (
        <ServiceAreaFormDialog
          key={editing?.id ?? "new"}
          area={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service area?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. Jobs already assigned keep their label;
              new jobs in this territory will no longer auto-resolve to it.
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

/**
 * The row's Status switch: off takes the area out of address matching and
 * overlap checks (it stays on old jobs), on puts it back.
 */
function ServiceAreaStatusSwitch({ area, disabled }: { area: ServiceArea; disabled: boolean }) {
  const update = useUpdateServiceArea(area.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${area.name} status`}
      checked={pending ?? area.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
