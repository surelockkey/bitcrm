"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FileText, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WZ_GRID_PAGE_SIZES, localGridView, nextGridSort, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { cn } from "@/lib/utils";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/deals/lib";
import { useItemCategories } from "@/features/inventory/products/hooks";
import { usePopup } from "@/features/inventory/use-popup";
import { WzConfirm } from "@/features/inventory/item-edit/wz";
import type { CatalogStatus } from "../lib";
import { usePriceBookPageReady } from "../components/price-book-frame";
import { useItemGroups, useUpdateItemGroup } from "./hooks";
import { filterItemGroups, itemGroupRows, itemGroupsToCsv, type ItemGroupRow } from "./lib";
import { ItemGroupDialog } from "./item-group-dialog";

/** Workiz's status box over the groups (`groupIsEnabledFilter`): Active by default, then All and Disabled. */
const STATUS_OPTIONS: { value: CatalogStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "all", label: "All" },
  { value: "disabled", label: "Disabled" },
];

/** Workiz's groups tab opens on 50 a page (pg_pricebook_wz_10_groups). */
const DEFAULT_PAGE_SIZE = 50;

/** Six 260px columns and the 140px Actions: 1700px, wider than the page — the rows scroll sideways (Workiz's react-table). */
const COLUMN_WIDTH = 260;
const ACTIONS_WIDTH = 140;
const GRID_WIDTH = COLUMN_WIDTH * 6 + ACTIONS_WIDTH;

type GroupPopup = { kind: "edit"; id: string } | { kind: "new" };

const NO_ROWS: ItemGroupRow[] = [];

/**
 * The Price book's "Item groups" tab (Workiz `/root/service_and_products/2`,
 * pg_pricebook_wz_10_groups): Workiz's sentence with the yellow Add New 20px
 * in from the right; the status box (Active / All / Disabled, 350×42) 117px
 * under the tab rule; the grey strip (Search, the page size — 50 —, Export);
 * the grid Name | Description | Items | Group type | Total | Category |
 * Actions, 260px columns that run past the page and scroll sideways in their
 * own box, the pager in it. One request holds every group, so search, sort
 * and pages are worked out here.
 *
 * The pencil (or the row) opens "Edit item group"; the trash disables after
 * Workiz's confirm (`active: false` — a job line keeps naming its group), and
 * the popup's Enable switch brings one back. Making one is `products.create`,
 * changing one `products.edit`, as the API checks.
 */
export function ItemGroupsTab() {
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const canView = permsLoading || can("products", "view");
  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");

  // Asked for beside the permissions, not after them; the server guards them.
  const groups = useItemGroups(canView);
  const categories = useItemCategories(canView);

  const [status, setStatus] = useState<CatalogStatus>("active");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);

  // One skeleton, then the page: the rows wait for the permissions (their
  // actions) and the categories (their column). Reported to the frame.
  const ready = usePriceBookPageReady(
    !permsLoading &&
      (groups.data !== undefined || groups.isError) &&
      (categories.data !== undefined || categories.isError || !categories.isLoading),
  );

  // By name, as the server answers (and Workiz's picker shows them).
  const all = useMemo(
    () => itemGroupRows(groups.data, categories.data).sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })),
    [groups.data, categories.data],
  );
  const sortColumns = useMemo<WzGridColumn<ItemGroupRow>[]>(
    () => [
      { id: "name", label: "Name", render: () => null, sortValue: (r) => r.name },
      { id: "description", label: "Description", render: () => null, sortValue: (r) => r.description },
      { id: "items", label: "Items", render: () => null, sortValue: (r) => r.items },
      { id: "groupType", label: "Group type", render: () => null, sortValue: (r) => r.groupType },
      { id: "total", label: "Total", render: () => null, sortValue: (r) => r.total },
      { id: "category", label: "Category", render: () => null, sortValue: (r) => r.category },
    ],
    [],
  );
  const shown = useMemo(() => filterItemGroups(all, status, search), [all, status, search]);
  const view = useMemo(
    () => localGridView(shown, sortColumns, { query: "", sort, page, size }),
    [shown, sortColumns, sort, page, size],
  );

  const { popup, open, close } = usePopup<GroupPopup>();
  const editId = popup?.kind === "edit" ? popup.id : null;
  const editing = editId ? (ready ? (groups.data?.find((g) => g.id === editId) ?? null) : undefined) : undefined;
  const [deleting, setDeleting] = useState<ItemGroupRow | null>(null);
  const update = useUpdateItemGroup();

  if (denied("products")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view the price book.</p>
      </div>
    );
  }

  const columns = groupColumns({ canEdit, onEdit: (r) => open({ kind: "edit", id: r.id }), onDelete: setDeleting });

  return (
    <div className="flex flex-col">
      {/* The sentence 20px under the tab rule and 20px in; Add New level with it, 20px off the edge. */}
      <div className="flex h-[117px] shrink-0 items-start justify-between gap-5 px-5 pt-5">
        <p className="max-w-[317px] text-sm leading-4 text-wz-strong">
          Item groups help you add multiple items to invoices and estimates
        </p>
        {canCreate ? (
          <Button onClick={() => open({ kind: "new" })}>
            <Plus />
            Add New
          </Button>
        ) : null}
      </div>

      {/* The status box (groupIsEnabledFilter, 350×42), 20px over the strip. */}
      <div className="shrink-0 px-5 pb-5">
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
          <WzToolbarButton
            title="Export CSV"
            disabled={!ready || shown.length === 0}
            onClick={() => downloadCsv(itemGroupsToCsv(shown), "item-groups.csv")}
          >
            <FileText strokeWidth={1.5} /> Export
          </WzToolbarButton>
        </div>
      </WzListToolbar>

      {groups.isError && !groups.data ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm">
          <p role="alert">Couldn&apos;t load item groups</p>
        </div>
      ) : (
        <WzReportGrid
          aria-label="Item groups"
          className="shrink-0"
          columns={columns}
          rows={ready ? view.rows : NO_ROWS}
          rowKey={(r) => r.id}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(id) => {
            setSort((s) => nextGridSort(s, id));
            setPage(1);
          }}
          // The 25px pencil and bin in 20px padding: 65px rows, blanks and records alike.
          rowHeight={65}
          cellAlign="middle"
          minTableWidth={GRID_WIDTH}
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
        <ItemGroupDialog mode="edit" group={editing} onClose={close} />
      ) : popup?.kind === "new" ? (
        <ItemGroupDialog mode="new" onClose={close} />
      ) : null}

      <WzConfirm
        open={deleting !== null}
        onOpenChange={(o) => (o ? undefined : setDeleting(null))}
        title="Are you sure you want to delete?"
        message="The item group is disabled, not erased: it leaves Add item, the jobs that have it keep its lines, and it comes back with “Enable item group”."
        pending={update.isPending}
        onConfirm={() => {
          if (!deleting) return;
          update.mutate({ id: deleting.id, body: { active: false } }, { onSuccess: () => setDeleting(null) });
        }}
      />
    </div>
  );
}

/** A glyph in the Actions cell with Workiz's dark tooltip (the categories' 25px glyphs, 20px apart). */
function RowGlyph({
  label,
  tip,
  onClick,
  className,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          className={cn("flex shrink-0 cursor-pointer items-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{tip}</TooltipContent>
    </Tooltip>
  );
}

function groupColumns({
  canEdit,
  onEdit,
  onDelete,
}: {
  canEdit: boolean;
  onEdit: (r: ItemGroupRow) => void;
  onDelete: (r: ItemGroupRow) => void;
}): WzReportColumn<ItemGroupRow>[] {
  const text = (s: string) => (
    <span className="block truncate leading-4" title={s || undefined}>
      {s}
    </span>
  );
  return [
    { id: "name", label: "Name", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(r.name) },
    { id: "description", label: "Description", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(r.description) },
    { id: "items", label: "Items", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(r.items) },
    { id: "groupType", label: "Group type", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(r.groupType) },
    { id: "total", label: "Total", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(formatMoney(r.total)) },
    { id: "category", label: "Category", width: COLUMN_WIDTH, sortable: true, cell: (r) => text(r.category) },
    {
      id: "actions",
      label: "Actions",
      width: ACTIONS_WIDTH,
      cell: (r) =>
        canEdit ? (
          <div className="flex items-center gap-5">
            <RowGlyph label={`Edit item group ${r.name}`} tip="Edit item group" onClick={() => onEdit(r)} className="text-foreground">
              <WzEditIcon size={25} />
            </RowGlyph>
            {r.active ? (
              <RowGlyph label={`Delete item group ${r.name}`} tip="Delete item group" onClick={() => onDelete(r)} className="text-wz-danger">
                <WzTrashIcon size={25} />
              </RowGlyph>
            ) : null}
          </div>
        ) : null,
    },
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
