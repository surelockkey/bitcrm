"use client";

import { useCallback, useMemo, useState } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { ContainerTemplate } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { arraySource } from "@/lib/paging/array-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { settled } from "@/lib/use-page-ready";
import { useInventoryPageReady } from "@/features/inventory/components/inventory-frame";
import { LocationsBand } from "@/features/inventory/components/locations-grid";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { usePopup } from "@/features/inventory/use-popup";
import { useContainerTemplates } from "../hooks";
import { searchTemplates } from "../lib";
import { TEMPLATES_TABLE_KEY, TemplatesTable } from "./templates-table";
import { TemplateDialog } from "./template-dialog";
import { ApplyTemplateDialog } from "./apply-template-dialog";

/**
 * The popup over the list — one at a time: a template (`id: null` a new one),
 * or a template applied to a van.
 */
type TemplatesPopup =
  | { kind: "template"; id: string | null }
  | { kind: "apply"; templateId: string; containerId: string | null };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["template", "apply", "container"] as const;

/**
 * Container templates — BitCRM's own (a van's ideal loadout, applied to any
 * van: what it has, what is missing, fill the gap from a warehouse), drawn as
 * Workiz's Locations tab: Add New in the band; the strip with Search, the
 * status box and the page size; the grid with the pager in it.
 */
export function TemplatesPage() {
  const denied = useDenied();
  // Refused only once the permissions are known — never a flash of "No access".
  if (denied("containers", "view")) {
    return <NoAccess text="You don't have permission to view containers." />;
  }
  return <Templates />;
}

function Templates() {
  const { can, isLoading: permsLoading } = usePermissions();
  const [status, setStatus] = useState<InventoryStatus>(InventoryStatus.ACTIVE);
  const [search, setSearch] = useState("");
  // The server answers one status at a time, whole — templates are few; the
  // search and the pages run over the ones in hand.
  const query = useContainerTemplates(status);
  const all = useMemo(() => query.data ?? [], [query.data]);
  const matching = useMemo(() => searchTemplates(all, search), [all, search]);

  // Used by: the vans naming each template, across the whole fleet.
  const locations = useAllLocations();

  // One loader, then the list whole: the rows wait for the fleet (Used by)
  // and for the permissions (the row's glyphs). Latched: another status keeps
  // the rows on screen, dimmed.
  const ready = useInventoryPageReady(!permsLoading && settled(query) && !locations.isLoading);
  const loading = !ready;
  const [pageSize, setPageSize] = usePageSize(TEMPLATES_TABLE_KEY, { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const pager = usePager(arraySource(matching, pageSize, loading), {
    total: loading ? undefined : matching.length,
    pageSize,
    resetKey: JSON.stringify({ status, search, pageSize }),
  });
  const templates = pager.items;
  const failed = query.isError && !query.data;

  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of locations.data) {
      if (l.type === "container" && l.templateId) counts.set(l.templateId, (counts.get(l.templateId) ?? 0) + 1);
    }
    return counts;
  }, [locations.data]);

  const { popup, open, close } = usePopup<TemplatesPopup>(STALE_PARAMS);
  const onEdit = useCallback((t: ContainerTemplate) => open({ kind: "template", id: t.id }), [open]);
  const onApply = useCallback(
    (t: ContainerTemplate) => open({ kind: "apply", templateId: t.id, containerId: null }),
    [open],
  );

  return (
    <div className="flex flex-col">
      <LocationsBand
        canAdd={permsLoading || can("containers", "create")}
        pending={permsLoading}
        onAdd={() => open({ kind: "template", id: null })}
      />

      <WzListToolbar data-testid="templates-toolbar" className="shrink-0">
        <WzSearchBox value={search} onChange={setSearch} />
        <Select value={status} onValueChange={(v) => setStatus(v as InventoryStatus)}>
          <SelectTrigger className="h-10 w-[200px]" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>
        <WzPageSizeSelect className="ml-auto" value={pageSize} sizes={WZ_GRID_PAGE_SIZES} onChange={setPageSize} />
      </WzListToolbar>

      {failed ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load templates</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch()}>
            Retry
          </Button>
        </div>
      ) : (
        <TemplatesTable
          templates={templates}
          usedBy={usedBy}
          loading={loading}
          stale={query.isPlaceholderData}
          onEdit={onEdit}
          onApply={onApply}
          // Drawn with the rows, its total and all — never under the loader.
          footer={ready ? <WzPager pager={pager} plainNumbers /> : null}
        />
      )}

      {/* Mounted only while open, so each opening reads fresh. */}
      {popup?.kind === "template" ? (
        <TemplateDialog templateId={popup.id} open onOpenChange={(next) => (next ? undefined : close())} />
      ) : null}
      {popup?.kind === "apply" ? (
        <ApplyTemplateDialog
          templateId={popup.templateId}
          containerId={popup.containerId}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
      ) : null}
    </div>
  );
}
