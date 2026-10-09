"use client";

import { useMemo, useState, type ReactNode } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { Product, ProductLocationStock } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProduct, useProductStock } from "@/features/inventory/products/hooks";
import { filterStockRows, pageSlice, stockSummary } from "../lib";
import { StockRowActions } from "./stock-row-actions";
import {
  PanelError,
  STOCK_MODAL,
  STOCK_TD,
  STOCK_TR,
  StockMetricCard,
  StockNoRows,
  StockPager,
  StockSectionLoading,
  StockTableHead,
  StockTableSection,
  usePopupPageSize,
} from "./stock-popup-parts";

/**
 * Workiz's "Manage stock" popup for one item (pg_inventory_wz_05_stock_popup):
 * "Manage stock - <name>", the TOTAL ON HAND / TOTAL COST / SALE VALUE cards,
 * then every location — Location, Description, Quantity, Actions (add, move,
 * return) — with search and pages, and Done.
 *
 * The endpoint returns every location at once, so search and paging happen
 * here. `allowAdd={false}` drops the ＋ — stock arrives only from the Inventory tab.
 */
export function ManageStockDialog({
  productId,
  open,
  onOpenChange,
  allowAdd = true,
}: {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowAdd?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={STOCK_MODAL}>
        <ManageStock productId={productId} open={open} allowAdd={allowAdd} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

const HEADERS = [
  { label: "Location", width: undefined },
  { label: "Description", width: undefined },
  { label: "Quantity", width: undefined },
];
const ACTIONS_HEADER = { label: "Actions", width: "w-[150px]" };

function ManageStock({
  productId,
  open,
  allowAdd,
  onDone,
}: {
  productId: string;
  open: boolean;
  allowAdd: boolean;
  onDone: () => void;
}) {
  const { can } = usePermissions();
  // Its row in the Inventory list gives the title and the prices at once.
  const product = useProduct(productId, { seed: true });
  const stock = useProductStock(productId, open);

  const item = product.data;
  // Workiz's item names carry their SKU already: "Manage stock - Don-Jo - Chain Guard - Silver (1607-625) (SLK-3551)".
  const title = item ? `Manage stock - ${item.name}` : "Manage stock";
  const money = can("financials", "view");
  const actions = can("transfers", "create");
  const [size, setSize] = usePopupPageSize();
  const headers = actions ? [...HEADERS, ACTIONS_HEADER] : HEADERS;

  let body: ReactNode;
  if (product.isError || stock.isError) {
    body = (
      <PanelError
        onRetry={() => {
          if (product.isError) product.refetch();
          if (stock.isError) stock.refetch();
        }}
      />
    );
  } else if (product.isLoading || stock.isLoading || !item || !stock.data) {
    body = (
      <>
        <Cards money={money} />
        <StockSectionLoading
          testId="manage-stock-loading"
          searchLabel="Search locations"
          headers={headers}
          size={size}
          onSize={setSize}
        />
      </>
    );
  } else {
    body = (
      <StockBody
        product={item}
        onHand={stock.data.onHand}
        locations={stock.data.locations}
        money={money}
        actions={actions}
        allowAdd={allowAdd}
        headers={headers}
        size={size}
        onSize={setSize}
      />
    );
  }

  return (
    <>
      {/* stockModalHeader: the h4 (18px/27px 600 ink), 8px + 24px over the cards; × at the right. */}
      <div className="mb-2 shrink-0 pr-10">
        <DialogTitle className="truncate">{title}</DialogTitle>
        <DialogDescription className="sr-only">This item&apos;s stock in every warehouse and van.</DialogDescription>
      </div>
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">{body}</div>
      {/* stockModalFooter: Done, Workiz's 40px yellow pill, at the right. */}
      <div className="flex shrink-0 justify-end gap-4 pt-6">
        <WzButton variant="primary" size="big" onClick={onDone}>
          Done
        </WzButton>
      </div>
    </>
  );
}

/** The three cards: TOTAL ON HAND · TOTAL COST (money) · SALE VALUE, a third of the row each, 16px apart. */
function Cards({ money, values }: { money: boolean; values?: ReturnType<typeof stockSummary> }) {
  const blank = " ";
  return (
    <div className={cn("grid shrink-0 gap-4", money ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      <StockMetricCard label="Total on hand" value={values?.onHand ?? blank} />
      {money ? <StockMetricCard label="Total cost" value={values?.cost ?? blank} /> : null}
      <StockMetricCard label="Sale value" value={values?.sale ?? blank} />
    </div>
  );
}

function StockBody({
  product,
  onHand,
  locations,
  money,
  actions,
  allowAdd,
  headers,
  size,
  onSize,
}: {
  product: Product;
  onHand: number;
  locations: ProductLocationStock[];
  money: boolean;
  actions: boolean;
  allowAdd: boolean;
  headers: { label: string; width?: string }[];
  size: number;
  onSize: (size: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const summary = stockSummary(onHand, product);
  const matching = useMemo(() => filterStockRows(locations, search), [locations, search]);
  const view = pageSlice(matching, page, size);

  return (
    <>
      <Cards money={money} values={summary} />
      <StockTableSection
        search={search}
        onSearch={(term) => {
          setSearch(term);
          setPage(1);
        }}
        searchLabel="Search locations"
        size={size}
        onSize={(n) => {
          onSize(n);
          setPage(1);
        }}
        pager={<StockPager view={view} onPage={setPage} />}
      >
        <table className="w-full min-w-[36rem] table-fixed border-collapse">
          <StockTableHead columns={headers} />
          <tbody>
            {view.rows.length === 0 ? (
              <StockNoRows columns={headers.length}>
                {locations.length === 0 ? "No warehouses or containers yet." : "No rows found"}
              </StockNoRows>
            ) : (
              view.rows.map((l) => (
                <LocationRow
                  key={`${l.locationType}:${l.locationId}`}
                  location={l}
                  product={product}
                  actions={actions}
                  allowAdd={allowAdd}
                />
              ))
            )}
          </tbody>
        </table>
      </StockTableSection>
    </>
  );
}

function LocationRow({
  location: l,
  product,
  actions,
  allowAdd,
}: {
  location: ProductLocationStock;
  product: Product;
  actions: boolean;
  allowAdd: boolean;
}) {
  // A location deleted in Workiz is listed only while it still holds the item,
  // so its units stay counted and can still be moved or returned.
  const deleted = l.placeholder === true;
  const archived = deleted || l.status === InventoryStatus.ARCHIVED;
  return (
    <tr className={cn(STOCK_TR, deleted && "opacity-55")}>
      <td className={STOCK_TD}>
        <span className="block truncate" title={l.name}>
          {l.name}
          {archived ? <span className="text-wz-outline-label"> ({deleted ? "deleted in Workiz" : "archived"})</span> : null}
        </span>
      </td>
      <td className={STOCK_TD}>
        <span className="block truncate" title={l.description || undefined}>
          {l.description ?? ""}
        </span>
      </td>
      <td className={cn(STOCK_TD, "tabular-nums")}>{Math.round(l.quantity)}</td>
      {actions ? (
        <td className={cn(STOCK_TD, "h-14 py-0")}>
          <StockRowActions
            target={{
              product: { id: product.id, name: product.name },
              location: { type: l.locationType, id: l.locationId, name: l.name },
              available: l.quantity,
            }}
            allowAdd={allowAdd}
            archived={archived}
          />
        </td>
      ) : null}
    </tr>
  );
}
