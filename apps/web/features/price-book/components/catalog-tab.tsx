"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileText, Plus } from "lucide-react";
import type { Resource } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WzItemImage } from "@/components/workiz/item-image";
import { WZ_GRID_PAGE_SIZES, localGridView, nextGridSort, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { usePopup } from "@/features/inventory/use-popup";
import { WzConfirm } from "@/features/inventory/item-edit/wz";
import { useCategoryItemCounts, useUpdateCatalogEntry, type CatalogKind } from "../hooks";
import { catalogRows, catalogsToCsv, filterCatalog, type CatalogEntry, type CatalogRow, type CatalogStatus } from "../lib";
import { CatalogDialog } from "./catalog-dialog";
import { usePriceBookPageReady } from "./price-book-frame";

/** Everything that differs between Workiz's "Item categories" and "Item brands" tabs. */
export interface CatalogConfig {
  kind: CatalogKind;
  resource: Resource;
  /** "category" / "brand" — for the screen reader and the confirm. */
  noun: string;
  /** The yellow button: Workiz writes "Add new" on categories, "Add New" on brands. */
  addLabel: string;
  /** The words over the list (categories only). */
  subtitle?: string;
  /** Popup titles, Workiz's own. */
  titles: { create: string; edit: string };
  /** The row glyphs' tooltips. */
  tips: { edit: string; delete: string };
  /** The popup's name field. */
  nameLabel: string;
  /** The Enable switch and the line under it. */
  enableLabel: string;
  enableHint: string;
  /** The trash's confirm. */
  deleteTitle: string;
  deleteMessage: string;
}

/** Workiz's catalog status box: Active by default, then All and Disabled. */
const STATUS_OPTIONS: { value: CatalogStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "disabled", label: "Disabled" },
];

/** The popup over the list: an entry's Edit, or a new entry. */
type CatalogPopup = { kind: "edit"; id: string } | { kind: "new" };

/** Old links carried the popup in the query; they land on the plain list, the params dropped. */
const STALE_PARAMS = ["edit", "new"] as const;

const NO_ROWS: CatalogRow[] = [];

/**
 * One of Workiz's two small catalogs as a Price book tab
 * (`/root/service_and_products/3` and `/4`, pg_pricebook_wz_11 / _12):
 * the subtitle (categories) with the yellow Add new at the right; the status
 * box (Active / All / Disabled — Workiz's on categories, ours on brands too,
 * since a disabled brand comes back from it); the grey strip (Search, the
 * page size, Export on categories); the react-table grid with the pager in
 * it. The catalog is one request, so search, sort and pages are worked out
 * here.
 *
 * The pencil (or the row) opens Workiz's "Edit category" / "Edit brand"; the
 * trash archives after Workiz's confirm (`active: false` — BitCRM never
 * deletes a catalog row, items still name it), and the Enable switch in the
 * popup brings one back. Both are the edit permission's, as the API checks.
 */
export function CatalogTab({
  config,
  query,
}: {
  config: CatalogConfig;
  query: { data?: CatalogEntry[]; isLoading: boolean; isError: boolean; refetch?: () => unknown };
}) {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canCreate = can(config.resource, "create");
  const canEdit = can(config.resource, "edit");
  const categories = config.kind === "categories";

  const [status, setStatus] = useState<CatalogStatus>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const all = useMemo(() => catalogRows(query.data), [query.data]);
  const names = useMemo(() => all.map((r) => r.fullName), [all]);
  // Workiz's "No. of active items": counted with the catalog, so the column
  // comes with the rows. Brands have no such column.
  const counts = useCategoryItemCounts(categories ? names : [], categories && !permsLoading && query.data !== undefined);

  // A catalog the permissions haven't enabled yet has no data and isn't
  // "loading" either — it is still the loader, not an empty catalog. The
  // rows also wait for the permissions (their actions) and the counts.
  // Reported to the frame: the tab row appears in this same frame.
  const ready = usePriceBookPageReady(!permsLoading && (query.data !== undefined || query.isError) && !counts.isLoading);

  const sortColumns = useMemo<WzGridColumn<CatalogRow>[]>(
    () => [
      { id: "name", label: "Name", render: () => null, sortValue: (r) => r.name },
      { id: "description", label: "Description", render: () => null, sortValue: (r) => r.description },
      { id: "parent", label: "Parent category", render: () => null, sortValue: (r) => r.parentName },
      { id: "items", label: "No. of active items", render: () => null, sortValue: (r) => counts.counts.get(r.fullName) },
    ],
    [counts.counts],
  );
  const shown = useMemo(() => filterCatalog(all, status, search), [all, status, search]);
  const view = useMemo(() => localGridView(shown, sortColumns, { query: "", sort, page, size }), [shown, sortColumns, sort, page, size]);

  const { popup, open, close } = usePopup<CatalogPopup>(STALE_PARAMS);
  const editId = popup?.kind === "edit" ? popup.id : null;
  const creating = popup?.kind === "new";
  const editing = editId ? (ready ? (all.find((r) => r.id === editId) ?? null) : undefined) : undefined;
  const [deleting, setDeleting] = useState<CatalogRow | null>(null);
  const update = useUpdateCatalogEntry(config.kind);

  if (denied(config.resource)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view {categories ? "categories" : "brands"}.</p>
      </div>
    );
  }

  const columns = catalogColumns({
    config,
    counts: counts.counts,
    canEdit,
    onEdit: (r) => open({ kind: "edit", id: r.id }),
    onDelete: setDeleting,
  });
  const addButton = canCreate ? (
    <Button onClick={() => open({ kind: "new" })}>
      <Plus />
      {config.addLabel}
    </Button>
  ) : null;

  return (
    <div className="flex flex-col">
      {config.subtitle ? (
        // categoryManagement subTitleWrapper: 120px, the words 20px in, Add new 15px off the edge.
        <div className="flex min-h-[120px] shrink-0 items-center justify-between gap-5 pr-[15px] pl-5">
          <p className="text-sm leading-[21px] text-foreground">{config.subtitle}</p>
          {addButton}
        </div>
      ) : (
        // Brands: Add New 16px under the tab rule and 16px off the edge; the strip 25px under it.
        <div className="flex min-h-[72px] shrink-0 items-start justify-end pt-4 pr-4">{addButton}</div>
      )}

      {/* The status box (categoryIsEnabledFilter, 350px), 20px all round. */}
      <div className="shrink-0 p-5">
        <WzOutlinedSelect
          label="Status"
          labelHidden
          className="w-[350px] max-w-full"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => {
            setStatus(v as CatalogStatus);
            setPage(1);
          }}
        />
      </div>

      <WzListToolbar className="shrink-0">
        <WzSearchBox
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          maxLength={100}
        />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect
            value={size}
            sizes={WZ_GRID_PAGE_SIZES}
            onChange={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
          {categories ? (
            <WzToolbarButton
              title="Export CSV"
              disabled={!ready || shown.length === 0}
              onClick={() => downloadCsv(catalogsToCsv(shown, counts.counts), "item-categories.csv")}
            >
              <FileText strokeWidth={1.5} /> Export
            </WzToolbarButton>
          ) : null}
        </div>
      </WzListToolbar>

      {query.isError && !query.data ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load {categories ? "categories" : "brands"}</p>
          {query.refetch ? (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => query.refetch?.()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : (
        <WzReportGrid
          aria-label={categories ? "Item categories" : "Item brands"}
          className="shrink-0"
          // Workiz's rows: categories 80px (the 40px picture), brands 61px (pg_pricebook).
          rowHeight={categories ? 80 : 61}
          columns={columns}
          rows={ready ? view.rows : NO_ROWS}
          rowKey={(r) => r.id}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(id) => {
            setSort((s) => nextGridSort(s, id));
            setPage(1);
          }}
          cellAlign="middle"
          onRowClick={canEdit ? (r) => open({ kind: "edit", id: r.id }) : undefined}
          loading={!ready}
          plainFiller
          footer={
            ready ? (
              <WzPager
                plainNumbers
                pager={{
                  page: view.page,
                  from: view.from,
                  to: view.to,
                  total: view.total,
                  totalPages: view.pages,
                  canPrev: view.page > 1,
                  canNext: view.page < view.pages,
                  isFetching: false,
                  prev: () => setPage(view.page - 1),
                  next: () => setPage(view.page + 1),
                }}
              />
            ) : null
          }
        />
      )}

      {editId ? (
        <CatalogDialog config={config} mode="edit" entry={editing} canSave={canEdit} onClose={close} />
      ) : creating ? (
        <CatalogDialog config={config} mode="new" canSave={canCreate} onClose={close} />
      ) : null}

      <WzConfirm
        open={deleting !== null}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        title={config.deleteTitle}
        message={config.deleteMessage}
        pending={update.isPending}
        onConfirm={() => {
          if (!deleting) return;
          update.mutate({ id: deleting.id, body: { active: false } }, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

/**
 * A glyph button in the Actions cell, with Workiz's dark tooltip. `locked`
 * is Workiz's `disableClick`: greyed (#bfc4c7), not-allowed, the tooltip
 * saying why — still hoverable, so it stays `aria-disabled`, not `disabled`.
 */
function RowGlyph({
  label,
  tip,
  onClick,
  className,
  locked = false,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  className: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-disabled={locked || undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (!locked) onClick();
          }}
          className={cn(
            "flex shrink-0 items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            locked ? "cursor-not-allowed text-wz-outline-disabled" : cn("cursor-pointer", className),
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Workiz's reason on a greyed category trash. */
const CANNOT_DELETE = "Categories containing sub-categories/items cannot be deleted";

/**
 * The grid's columns. Categories: Name (the 40px picture, 10px, its own
 * name), Description, Parent category, No. of active items, Actions 140px
 * (25px glyphs 20px apart). Brands: Name, Description, Actions 130px (20px
 * glyphs). Words are cut with "…" (categoryManagement `tableRow`).
 */
function catalogColumns({
  config,
  counts,
  canEdit,
  onEdit,
  onDelete,
}: {
  config: CatalogConfig;
  counts: Map<string, number>;
  canEdit: boolean;
  onEdit: (r: CatalogRow) => void;
  onDelete: (r: CatalogRow) => void;
}): WzReportColumn<CatalogRow>[] {
  const categories = config.kind === "categories";
  const text = (s: string) => (
    <span className="block truncate leading-5" title={s || undefined}>
      {s}
    </span>
  );
  // Workiz: the categories' 25px font glyphs; the brands' edit.svg (20) and delete-red.svg (21).
  const glyph = categories ? 25 : 20;
  const actions: WzReportColumn<CatalogRow> = {
    id: "actions",
    label: "Actions",
    width: categories ? 140 : 130,
    cell: (r) =>
      canEdit ? (
        <div className={`flex items-center ${categories ? "gap-5" : "gap-4"}`}>
          <RowGlyph label={`${config.tips.edit} ${r.name}`} tip={config.tips.edit} onClick={() => onEdit(r)} className="text-foreground">
            <WzEditIcon size={glyph} />
          </RowGlyph>
          {r.active ? (
            (() => {
              // Workiz refuses to delete a category that holds items or
              // sub-categories; "Enable category" in the popup still turns it off.
              const locked = categories && (r.hasChildren || (counts.get(r.fullName) ?? 0) > 0);
              return (
                <RowGlyph
                  label={`${config.tips.delete} ${r.name}`}
                  tip={locked ? CANNOT_DELETE : config.tips.delete}
                  onClick={() => onDelete(r)}
                  className="text-wz-danger"
                  locked={locked}
                >
                  <WzTrashIcon size={categories ? glyph : 21} />
                </RowGlyph>
              );
            })()
          ) : null}
        </div>
      ) : null,
  };
  if (!categories) {
    return [
      { id: "name", label: "Name", sortable: true, cell: (r) => text(r.name) },
      { id: "description", label: "Description", sortable: true, cell: (r) => text(r.description) },
      actions,
    ];
  }
  return [
    {
      id: "name",
      label: "Name",
      sortable: true,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <WzItemImage src={r.picture} />
          {text(r.name)}
        </div>
      ),
    },
    { id: "description", label: "Description", sortable: true, cell: (r) => text(r.description) },
    { id: "parent", label: "Parent category", sortable: true, cell: (r) => text(r.parentName) },
    { id: "items", label: "No. of active items", sortable: true, cell: (r) => text(String(counts.get(r.fullName) ?? "")) },
    actions,
  ];
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
