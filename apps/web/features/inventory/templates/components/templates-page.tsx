"use client";

import { useMemo, useState } from "react";
import { ClipboardList, Plus, TriangleAlert } from "lucide-react";
import { InventoryStatus } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ListPagination } from "@/components/ui/list-pagination";
import { arraySource } from "@/lib/paging/array-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/inventory/components/no-access";
import { ListBody } from "@/features/inventory/components/list-body";
import { useSkeletonRows } from "@/features/inventory/components/use-skeleton-rows";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { useLinkedPopup, usePopup, type LegacyPopupQuery } from "@/features/inventory/use-popup";
import { useContainerTemplates } from "../hooks";
import { TEMPLATES_TABLE_KEY, TemplatesTable } from "./templates-table";
import { TemplateDialog } from "./template-dialog";
import { ApplyTemplateDialog } from "./apply-template-dialog";

const PATH = "/inventory/templates";
/**
 * The popup over the list — one at a time: a template (`id: null` a new one),
 * or a template applied to a van.
 */
export type TemplatesPopup =
  | { kind: "template"; id: string | null }
  | { kind: "apply"; templateId: string; containerId: string | null };

/** Old links carried the popup in the query (`?template=<id|new>`, `?apply=<id>&container=<id>`). */
const LEGACY: LegacyPopupQuery<TemplatesPopup> = {
  params: ["template", "apply", "container"],
  parse: (q) => {
    const template = q.get("template");
    if (template) return { kind: "template", id: template === "new" ? null : template };
    const apply = q.get("apply");
    return apply ? { kind: "apply", templateId: apply, containerId: q.get("container") } : null;
  },
};

/**
 * Container templates: a van's ideal loadout, made once and applied to any
 * van — see what it has, what is missing, and fill the gap from a warehouse.
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
  // The server answers one status at a time, whole — templates are few, but
  // the table still pages, under the same panel as every other list.
  const query = useContainerTemplates(status);
  const all = useMemo(() => query.data ?? [], [query.data]);
  const loading = query.isLoading && !query.data;
  const [pageSize, setPageSize] = usePageSize(TEMPLATES_TABLE_KEY);
  const pager = usePager(arraySource(all, pageSize, loading), {
    total: loading ? undefined : all.length,
    pageSize,
    resetKey: JSON.stringify({ status, pageSize }),
  });
  const templates = pager.items;
  const failed = query.isError && !query.data;
  const empty = !failed && !loading && templates.length === 0;
  const skeletonRows = useSkeletonRows(
    TEMPLATES_TABLE_KEY,
    pageSize,
    undefined,
    loading ? undefined : templates.length,
  );

  // Used by: the vans naming each template, across the whole fleet.
  const locations = useAllLocations();
  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of locations.data) {
      if (l.type === "container" && l.templateId) counts.set(l.templateId, (counts.get(l.templateId) ?? 0) + 1);
    }
    return counts;
  }, [locations.data]);

  const { popup, open, close } = usePopup(useLinkedPopup(null, LEGACY), PATH);

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <Select value={status} onValueChange={(v) => setStatus(v as InventoryStatus)}>
          <SelectTrigger className="h-9 w-32" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto" />
        {permsLoading || can("containers", "create") ? (
          <Button
            className="h-9 gap-1.5 px-3.5"
            disabled={permsLoading}
            onClick={() => open({ kind: "template", id: null })}
          >
            <Plus className="size-4" />
            New template
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        <ListBody
          holdKey={status}
          scrollKey={`${pager.page}:${pageSize}`}
          pager={
            failed || empty ? null : (
              <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} reserveSpace />
            )
          }
        >
          {failed ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                <TriangleAlert className="size-6" />
              </div>
              <div className="font-medium">Couldn&apos;t load templates</div>
              <Button variant="outline" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <ClipboardList className="size-6" />
              </div>
              <div>
                <div className="font-medium">
                  {status === InventoryStatus.ACTIVE ? "No templates yet" : "No archived templates"}
                </div>
                {status === InventoryStatus.ACTIVE ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    A template is a van&apos;s ideal loadout — make one, then apply it to any van.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <TemplatesTable
                templates={templates}
                usedBy={usedBy}
                usedByPending={locations.isLoading}
                loading={loading}
                skeletonRows={skeletonRows}
                onEdit={(t) => open({ kind: "template", id: t.id })}
                onApply={(t) => open({ kind: "apply", templateId: t.id, containerId: null })}
              />
            </>
          )}
        </ListBody>
      </div>

      {/* Mounted only while open, so each opening reads fresh. */}
      {popup?.kind === "template" ? (
        <TemplateDialog
          templateId={popup.id}
          open
          onOpenChange={(next) => (next ? undefined : close())}
        />
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
