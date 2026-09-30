"use client";

import { useMemo, useState } from "react";
import { Archive, MoreHorizontal, Pencil, Plus, RotateCcw, Search, TriangleAlert } from "lucide-react";
import type { Brand, ProductCategory, Resource } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { usePopup } from "@/features/inventory/use-popup";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { useUpdateCatalogEntry, type CatalogKind } from "../hooks";
import { useSkeletonRows } from "../use-skeleton-rows";
import { StatusBadge } from "./items-table";
import { PriceBookTable, ROW_HEIGHT, type PriceBookColumn } from "./price-book-table";
import { CatalogDialog } from "./catalog-dialog";

/** A category and a brand are the same shape: a name and whether it's offered. */
export type CatalogRow = ProductCategory | Brand;

/** Everything that differs between the Categories and the Brands tabs. */
export interface CatalogConfig {
  kind: CatalogKind;
  path: string;
  resource: Resource;
  noun: string;
  Noun: string;
  plural: string;
  /** Under the popup's title. */
  description: string;
  /** Under the Active switch. */
  activeHint: string;
  /** The archive confirm's body. */
  archiveHint: string;
  /** Shown while a rename is pending, when renaming has a consequence worth saying. */
  renameHint?: (oldName: string) => string;
}

const COLUMNS: PriceBookColumn[] = [
  { id: "name", label: "Name", width: 360 },
  { id: "status", label: "Status", width: 140 },
  { id: "actions", label: "Actions", width: 90 },
];

/** A catalog is small and read whole; the skeleton never needs more than this. */
const SKELETON_CAP = 25;

/** The popup over the list: an entry's Edit, or a new entry. */
type CatalogPopup = { kind: "edit"; id: string } | { kind: "new" };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["edit", "new"] as const;

/**
 * One small catalog — item categories or brands — as a Price Book tab.
 *
 * The whole catalog is one request, so the search box filters it in place.
 * New and Edit are popups over the list, held in state. Archive
 * and Restore are the same PUT as Edit (`active: false` / `true`), so they
 * follow the edit permission, which is what the API checks.
 */
export function CatalogTab({
  config,
  query,
}: {
  config: CatalogConfig;
  query: { data?: CatalogRow[]; isLoading: boolean; isError: boolean; refetch?: () => unknown };
}) {
  const { can } = usePermissions();
  const denied = useDenied();
  const canCreate = can(config.resource, "create");
  const canEdit = can(config.resource, "edit");

  const [search, setSearch] = useState("");
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return [...(query.data ?? [])]
      .filter((r) => !term || r.name.toLowerCase().includes(term))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [query.data, search]);

  // A catalog the permissions haven't enabled yet has no data and isn't
  // "loading" either — it is still a skeleton, not an empty catalog.
  const loading = query.isLoading || (query.data === undefined && !query.isError);
  const tableKey = `price-book-${config.kind}`;
  const skeletonRows = useSkeletonRows(
    tableKey,
    SKELETON_CAP,
    undefined,
    query.data ? Math.min(query.data.length, SKELETON_CAP) : undefined,
  );

  const { popup, open, close } = usePopup<CatalogPopup>(STALE_PARAMS);
  const editId = popup?.kind === "edit" ? popup.id : null;
  const creating = popup?.kind === "new";
  const editing = editId
    ? loading
      ? undefined
      : ((query.data ?? []).find((r) => r.id === editId) ?? null)
    : undefined;

  if (denied(config.resource)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view {config.plural}.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${config.plural}`}
            aria-label={`Search ${config.plural}`}
            className="h-9 pl-8"
          />
        </div>
        <span className="ml-auto" />
        {canCreate ? (
          <Button className="h-9 gap-1.5 px-3.5" onClick={() => open({ kind: "new" })}>
            <Plus className="size-4" />
            New {config.noun}
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isError && !query.data ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load {config.plural}</div>
            {query.refetch ? (
              <Button variant="outline" onClick={() => query.refetch?.()}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : (
          <PriceBookTable
            tableKey={tableKey}
            columns={COLUMNS}
            loading={loading}
            skeletonRows={skeletonRows}
            empty={
              rows.length === 0 ? (
                <div>
                  <div className="font-medium">
                    {search.trim() ? `No ${config.plural} match` : `No ${config.plural} yet`}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {search.trim() ? "Try another search." : `Add the first with New ${config.noun}.`}
                  </p>
                </div>
              ) : undefined
            }
          >
            {rows.map((r) => (
              <TableRow
                key={r.id}
                className={cn(ROW_HEIGHT, canEdit && "cursor-pointer", !r.active && "opacity-55")}
                onClick={canEdit ? () => open({ kind: "edit", id: r.id }) : undefined}
              >
                <TableCell className="truncate font-medium" title={r.name}>
                  {r.name}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <StatusBadge archived={!r.active} />
                </TableCell>
                <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  {canEdit ? (
                    <div className="flex items-center gap-0.5">
                      <RowIconAction label={`Edit ${r.name}`} tip="Edit" onClick={() => open({ kind: "edit", id: r.id })}>
                        <Pencil />
                      </RowIconAction>
                      <CatalogRowActions config={config} row={r} />
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </PriceBookTable>
        )}
      </div>

      {editId ? (
        <CatalogDialog config={config} mode="edit" entry={editing} canSave={canEdit} onClose={close} />
      ) : creating ? (
        <CatalogDialog config={config} mode="new" canSave={canCreate} onClose={close} />
      ) : null}
    </div>
  );
}

/** The kebab: Archive (after a confirm) or Restore. */
function CatalogRowActions({ config, row }: { config: CatalogConfig; row: CatalogRow }) {
  const update = useUpdateCatalogEntry(config.kind);
  const [confirm, setConfirm] = useState(false);
  const setActive = (active: boolean) => update.mutate({ id: row.id, body: { active } });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Actions for ${row.name}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {row.active ? (
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
              <Archive />
              Archive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActive(true)}>
              <RotateCcw />
              Restore
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{row.name}”?</AlertDialogTitle>
            <AlertDialogDescription>{config.archiveHint}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => setActive(false)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
