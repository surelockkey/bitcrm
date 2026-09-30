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
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useAllLocations } from "@/features/inventory/stock/hooks";
import { useUrlPopups } from "@/features/inventory/use-url-popups";
import { useContainerTemplates } from "../hooks";
import { TemplatesTable } from "./templates-table";
import { TemplateDialog } from "./template-dialog";
import { ApplyTemplateDialog } from "./apply-template-dialog";

const PATH = "/inventory/templates";
/** The URL params that open a popup — one at a time; Apply also names a van. */
const POPUPS = ["template", "apply"] as const;
const EXTRAS = ["container"] as const;

/**
 * Container templates: a van's ideal loadout, made once and applied to any
 * van — see what it has, what is missing, and fill the gap from a warehouse.
 */
export function TemplatesPage() {
  const { can } = usePermissions();
  if (!can("containers", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view containers.</p>
      </div>
    );
  }
  return <Templates />;
}

function Templates() {
  const { can } = usePermissions();
  const [status, setStatus] = useState<InventoryStatus>(InventoryStatus.ACTIVE);
  // The server answers one status at a time, whole — templates are few.
  const query = useContainerTemplates(status);
  const templates = query.data ?? [];

  // Used by: the vans naming each template, across the whole fleet.
  const locations = useAllLocations();
  const usedBy = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of locations.data) {
      if (l.type === "container" && l.templateId) counts.set(l.templateId, (counts.get(l.templateId) ?? 0) + 1);
    }
    return counts;
  }, [locations.data]);

  const popups = useUrlPopups(PATH, POPUPS, EXTRAS);
  const templateParam = popups.param("template");
  const applyId = templateParam ? null : popups.param("apply");

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
        {can("containers", "create") ? (
          <Button className="h-9 gap-1.5 px-3.5" onClick={() => popups.open("template", "new")}>
            <Plus className="size-4" />
            New template
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load templates</div>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : templates.length === 0 ? (
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
          <TemplatesTable
            templates={templates}
            usedBy={usedBy}
            onEdit={(t) => popups.open("template", t.id)}
            onApply={(t) => popups.open("apply", t.id)}
          />
        )}
      </div>

      {/* Mounted only while their param is set, so each opening reads fresh. */}
      {templateParam ? (
        <TemplateDialog
          templateId={templateParam === "new" ? null : templateParam}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
        />
      ) : null}
      {applyId ? (
        <ApplyTemplateDialog
          templateId={applyId}
          containerId={popups.param("container")}
          open
          onOpenChange={(open) => (open ? undefined : popups.close())}
          onContainerChange={(id) => popups.replace("apply", applyId, { container: id })}
        />
      ) : null}
    </div>
  );
}
