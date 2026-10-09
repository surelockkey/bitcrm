"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { LocationSummaryType } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { WZ_GRID_PAGE_SIZES } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePermissions } from "@/features/auth/use-permissions";
import type { EnrichedStockRow } from "@/features/inventory/warehouses/lib";
import { wzAmount } from "@/features/inventory/products/items-view";
import { ApiError } from "@/lib/api/errors";
import { useLocationStock } from "../hooks";
import { filterItemRows, locationTotals, pageSlice } from "../lib";
import { StockRowActions } from "./stock-row-actions";
import { PanelError, usePopupPageSize } from "./stock-popup-parts";

/**
 * One warehouse's or van's stock — Workiz's "Manage stock: <name>"
 * (pg_inventory_wz_13_location_stock): a sheet over the whole window, the
 * location's name and description at the left, its Total Items On Hand /
 * Total Items cost / Sale Items Value at the right, then the standard grid
 * of what it holds — Product Name, Quantity, Price, Cost, Actions — and the
 * footer. Workiz's "Add items" column is left out (the owner's call: stock
 * arrives only from the Inventory tab); Move and Return leave from here.
 *
 * Mount it only while open (the tab pages do): the stock is read on mount.
 */
export function LocationStockDialog({
  type,
  locationId,
  open,
  onOpenChange,
  aside,
}: {
  type: LocationSummaryType;
  locationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** BitCRM's own, under the totals — the Containers tab puts the van's template strip here. */
  aside?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* modal-module__modalFullContainer: the whole window, 16px corners, 24px in. */}
      <DialogContent className="flex h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden p-6 sm:max-w-none">
        <LocationStock type={type} id={locationId} open={open} aside={aside} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Workiz's Tag-module "pending" tag: #f5ba45, 4px corners, 0 4px, white 14px/16px words. */
export function LowStockTag() {
  return <span className="inline-flex rounded-[4px] bg-[#f5ba45] px-1 text-sm leading-4 text-white">Low stock</span>;
}

/** h3.thin: 20px/25px 400 #3e4b51. */
const LINE = "text-[20px] leading-[25px] font-normal text-wz-tab-bar";

function LocationStock({
  type,
  id,
  open,
  aside,
  onDone,
}: {
  type: LocationSummaryType;
  id: string;
  open: boolean;
  aside?: ReactNode;
  onDone: () => void;
}) {
  const { can } = usePermissions();
  // One request: the location's name, description and its rows, named and priced.
  const stock = useLocationStock(type, id, open);
  // A stale link: the location itself is gone.
  const missing = stock.error instanceof ApiError && stock.error.status === 404;
  const kind = type === "container" ? "Container" : "Warehouse";
  const money = can("financials", "view");
  const actions = can("transfers", "create");
  const totals = locationTotals(stock.rows);
  const loading = stock.isLoading;
  // The server prices every row whose item still exists; with none priced
  // there is no value to show — "—", not a 0.00.
  const priced = stock.rows.length === 0 || stock.rows.some((r) => r.unitPrice != null);
  const costed = stock.rows.length === 0 || stock.rows.some((r) => r.unitCost != null);

  return (
    <>
      <DialogTitle className="shrink-0 truncate pr-10">
        {missing ? `${kind} not found` : `Manage stock: ${stock.name ?? ""}`}
      </DialogTitle>
      <DialogDescription className="sr-only">
        Every item this {type === "container" ? "van" : "warehouse"} holds.
      </DialogDescription>

      {missing ? (
        <p className="py-10 text-center text-sm text-wz-outline-label">It may have been deleted.</p>
      ) : (
        <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* The location at the left, its totals at the right — two halves, 35px apart. */}
          <div className="grid shrink-0 grid-cols-2 gap-[35px] pl-px">
            <div className="min-w-0">
              <h3 className={`${LINE} truncate`}>{stock.name ?? " "}</h3>
              <p className="mt-2 truncate text-sm leading-4">{stock.description ?? ""}</p>
            </div>
            <div className="flex flex-col gap-[30px]">
              <h3 className={LINE}>Total Items On Hand: {loading ? "" : totals.onHand}</h3>
              {money ? <h3 className={LINE}>Total Items cost: {loading ? "" : costed ? totals.cost : "—"}</h3> : null}
              <h3 className={LINE}>Sale Items Value: {loading ? "" : priced ? totals.sale : "—"}</h3>
            </div>
          </div>
          {aside ? <div className="mt-6 shrink-0">{aside}</div> : null}
          {stock.isError ? (
            <div className="mt-[33px]">
              <PanelError onRetry={() => stock.refetch()} />
            </div>
          ) : (
            <StockGrid
              rows={stock.rows}
              loading={loading}
              location={{ type, id, name: stock.name ?? "" }}
              money={money}
              actions={actions}
            />
          )}
        </div>
      )}

      {/* The sheet's foot: a rule, the button centred. Workiz's Save writes its
          Add items column — there is none here, so only the way out. */}
      <div className="-mx-6 -mb-6 flex shrink-0 justify-center gap-4 border-t border-border px-6 py-5">
        <WzButton variant="secondary" onClick={onDone}>
          Cancel
        </WzButton>
      </div>
    </>
  );
}

function StockGrid({
  rows,
  loading,
  location,
  money,
  actions,
}: {
  rows: EnrichedStockRow[];
  loading: boolean;
  location: { type: LocationSummaryType; id: string; name: string };
  money: boolean;
  actions: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = usePopupPageSize();
  // Already in name order — the server sorts.
  const matching = useMemo(() => filterItemRows(rows, search), [rows, search]);
  const view = pageSlice(matching, page, size);

  const columns = useMemo<WzReportColumn<EnrichedStockRow>[]>(() => {
    const cut = (text: string) => (
      <span className="block truncate" title={text}>
        {text}
      </span>
    );
    return [
      {
        id: "name",
        label: "Product Name",
        // Workiz's productNameColumn: the name, and 8px under it the "Low stock" Tag once the item ran low.
        cell: (r) => (
          <span className="flex flex-col items-start gap-2">
            {cut(r.name)}
            {r.isLow ? <LowStockTag /> : null}
          </span>
        ),
      },
      { id: "quantity", label: "Quantity", cell: (r) => Math.round(r.quantity) },
      { id: "price", label: "Price", cell: (r) => (r.unitPrice != null ? wzAmount(r.unitPrice) : "") },
      ...(money
        ? [{ id: "cost", label: "Cost", cell: (r: EnrichedStockRow) => (r.unitCost != null ? wzAmount(r.unitCost) : "") }]
        : []),
      ...(actions
        ? [
            {
              id: "actions",
              label: "Actions",
              width: 104,
              cell: (r: EnrichedStockRow) => (
                <StockRowActions
                  target={{ product: { id: r.productId, name: r.name }, location, available: r.quantity }}
                  allowAdd={false}
                  align="start"
                />
              ),
            },
          ]
        : []),
    ];
  }, [location, money, actions]);

  return (
    <div className="mt-[33px] flex flex-col" data-testid={loading ? "location-stock-loading" : undefined}>
      <WzListToolbar className="shrink-0">
        <WzSearchBox
          type="search"
          aria-label="Search items"
          value={search}
          disabled={loading}
          onChange={(term) => {
            setSearch(term);
            setPage(1);
          }}
        />
        <WzPageSizeSelect
          className="ml-auto"
          value={size}
          sizes={WZ_GRID_PAGE_SIZES}
          onChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      </WzListToolbar>
      <WzReportGrid
        aria-label="Stock"
        columns={columns}
        rows={view.rows}
        rowKey={(r) => r.productId}
        loading={loading}
        stickyHeader={false}
        plainFiller
        emptyText={rows.length === 0 ? "Nothing in stock here" : "No Records Found"}
        footer={
          loading ? null : (
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
          )
        }
      />
    </div>
  );
}
