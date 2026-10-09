"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Truck } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { WzToolbarButton } from "@/components/workiz/toolbar";
import { usePageReady } from "@/lib/use-page-ready";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useMyContainer } from "@/features/inventory/containers/hooks";
import { containerTitle } from "@/features/inventory/containers/lib";
import { locationStockQuery } from "@/features/inventory/stock/hooks";
import { downloadCsv } from "@/features/reports/billing/lib";
import { myStockCsv, myStockRows, myStockTotals, stockFigure, type MyStockRow } from "../my-stock";

/** Workiz's sheet heading (`h3.thin`): 20px/25px 400 #3e4b51 — the name and each total. */
const SHEET_H3 = "text-[20px] leading-[25px] font-normal tracking-[0.4px] text-[#3e4b51]";

/**
 * `/my-stock` — what is on the technician's van, as Workiz shows a location's
 * stock ("Manage stock: <location>", pg_inventory_wz_13_location_stock),
 * read-only: the van's name (20px) and description at the left, "Total Items
 * On Hand: N" at the right — and, for a viewer with `financials.view`,
 * Workiz's "Total Items cost" and "Sale Items Value" under it; then Workiz's
 * grey strip (Search, the page size, Export) and the grid: Product Name,
 * ours SKU and Category, Quantity, and Price and Cost for that same viewer.
 *
 * Low stock comes first — the only rows that need doing something about —
 * each with Workiz's own "Low stock" tag (#f5ba45) under the name. No "Add
 * items" column and no move / return glyphs: a technician moves stock by
 * putting it on a job, and the office does the restocking.
 *
 * One skeleton until the van and what is on it are both in.
 */
export function MyStockPage() {
  const denied = useDenied();
  const { can } = usePermissions();
  const money = can("financials", "view");
  const { data: container, isLoading: containerLoading, isError: containerError } = useMyContainer();
  const stock = useQuery({ ...locationStockQuery("container", container?.id ?? ""), enabled: Boolean(container?.id) });
  const rows = useMemo(() => myStockRows(stock.data?.rows ?? []), [stock.data]);
  const totals = useMemo(() => myStockTotals(rows), [rows]);
  // Latched: a refetch never takes the van away.
  const ready = usePageReady(!containerLoading && (!container || !stock.isLoading));

  const columns = useMemo<WzGridColumn<MyStockRow>[]>(
    () => [
      {
        id: "name",
        label: "Product Name",
        render: (r) => (
          <>
            <div className="truncate">{r.name}</div>
            {r.isLow ? (
              <p className="mt-2 inline-block rounded-[4px] bg-[#f5ba45] px-1 text-[13px] leading-[19px] text-white">Low stock</p>
            ) : null}
          </>
        ),
        sortValue: (r) => r.name,
        searchText: (r) => r.name,
      },
      { id: "sku", label: "SKU", render: (r) => r.sku ?? "", sortValue: (r) => r.sku, searchText: (r) => r.sku },
      {
        id: "category",
        label: "Category",
        render: (r) => r.category ?? "",
        sortValue: (r) => r.category,
        searchText: (r) => r.category,
      },
      { id: "quantity", label: "Quantity", render: (r) => stockFigure(r.quantity), sortValue: (r) => r.quantity },
      ...(money
        ? [
            { id: "price", label: "Price", render: (r: MyStockRow) => stockFigure(r.unitPrice), sortValue: (r: MyStockRow) => r.unitPrice },
            { id: "cost", label: "Cost", render: (r: MyStockRow) => stockFigure(r.cost), sortValue: (r: MyStockRow) => r.cost },
          ]
        : []),
    ],
    [money],
  );

  if (denied("containers", "view")) return <NoAccess entity="stock" />;

  if (!ready) {
    return (
      <div className="flex flex-1 flex-col" aria-busy>
        <div className="grid grid-cols-1 gap-x-[35px] gap-y-4 px-6 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-6 w-56 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
          </div>
          <Skeleton className="h-6 w-60 max-w-full" />
        </div>
        <Skeleton className="mx-6 mt-[60px] h-[71px]" />
        <Skeleton className="mx-6 mt-px h-80" />
      </div>
    );
  }

  if (containerError || !container) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Truck className="size-8 text-wz-outline-label" strokeWidth={1.5} />
        <h2 className="text-[18px] leading-[27px] font-semibold text-foreground">No van assigned</h2>
        <p className="max-w-xs text-[13px] leading-[19px] text-wz-outline-label">
          Ask the office to assign you a container — your stock shows up here once they do.
        </p>
      </div>
    );
  }

  const name = stock.data?.name || containerTitle(container);
  const description = [container.description, container.department].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* The sheet's head: the location at the left, its totals at the right, two equal columns. */}
      <div className="grid grid-cols-1 gap-x-[35px] gap-y-4 px-6 pt-6 md:grid-cols-2">
        <div>
          <h3 className={SHEET_H3}>{name}</h3>
          {description ? <p className="mt-2 text-sm leading-4 tracking-[0.4px] text-[#404040]">{description}</p> : null}
        </div>
        <div className="space-y-[30px]">
          <h3 className={SHEET_H3}>Total Items On Hand: {stockFigure(totals.onHand)}</h3>
          {money ? <h3 className={SHEET_H3}>Total Items cost: {stockFigure(totals.cost)}</h3> : null}
          {money ? <h3 className={SHEET_H3}>Sale Items Value: {stockFigure(totals.sale)}</h3> : null}
        </div>
      </div>

      <div className="px-6 pt-[33px] pb-12">
        {stock.isError ? (
          <div className="flex flex-col items-center gap-2 border border-wz-frame py-16 text-center">
            <p className="text-[15px] font-medium text-[#404040]">Couldn&apos;t load your stock</p>
            <p className="text-[13px] text-wz-outline-label">Check your connection and try again.</p>
          </div>
        ) : (
          <WzLocalGrid
            label="My stock"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.productId}
            toolbar={
              // After the page size, as Workiz's strip has it (order-last).
              <WzToolbarButton
                className="order-last"
                onClick={() => downloadCsv(`my-stock-${name.replace(/[^\w-]+/g, "-")}.csv`, myStockCsv(rows, { money }))}
              >
                <FileText strokeWidth={1.5} />
                Export
              </WzToolbarButton>
            }
          />
        )}
      </div>
    </div>
  );
}
