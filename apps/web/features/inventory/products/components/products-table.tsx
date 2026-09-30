"use client";

import { Boxes, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMoney } from "../lib";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import {
  INVENTORY_ROW,
  InventoryTable,
  type InventoryColumn,
} from "@/features/inventory/components/inventory-table";
import { useProductRowActions } from "./product-row-actions";

type ColumnId =
  | "productId"
  | "name"
  | "description"
  | "price"
  | "cost"
  | "quantity"
  | "sku"
  | "category"
  | "actions";

/**
 * The Workiz item grid, in its order, with the width each column starts at.
 *
 * One place, read by both the `<colgroup>` and the headers: a width written
 * twice is a width that drifts. From here on the reader owns it — the drag
 * handle writes their own into `useColumnWidths`. Everything is left-aligned,
 * money and counts included: that is how Workiz lays the grid out.
 *
 * Together they fit the ~1250px a 1600px screen leaves beside the sidebar —
 * at 1430 the Actions column was cut to "Actio" and Manage stock went missing.
 */
const COLUMNS: (InventoryColumn & { id: ColumnId })[] = [
  { id: "productId", label: "Product ID", width: 100 },
  { id: "name", label: "Name", width: 260 },
  { id: "description", label: "Description", width: 220 },
  { id: "price", label: "Price", width: 95 },
  { id: "cost", label: "Cost", width: 95 },
  { id: "quantity", label: "Quantity", width: 90 },
  { id: "sku", label: "SKU", width: 130 },
  { id: "category", label: "Category", width: 130 },
  // Three 32px buttons, their gaps and the cell's padding.
  { id: "actions", label: "Actions", width: 120 },
];

const WITHOUT_COST = COLUMNS.filter((c) => c.id !== "cost");

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-items";

export function ProductsTable({
  products,
  showCost,
  onEdit,
  onStock,
  loading = false,
  skeletonRows = 0,
  stale = false,
}: {
  products: Product[];
  /**
   * Company cost is money: only for `financials.view`. `"pending"` while the
   * permissions load — the column keeps its place and its cells wait, so it
   * neither appears late nor shows money it may not.
   */
  showCost: boolean | "pending";
  onEdit: (product: Product) => void;
  onStock: (product: Product) => void;
  /** First load: the same table, a page of skeleton rows. */
  loading?: boolean;
  skeletonRows?: number;
  /** The previous filter's rows, held while the new ones load. */
  stale?: boolean;
}) {
  const columns = showCost ? COLUMNS : WITHOUT_COST;
  const actions = useProductRowActions();

  return (
    <>
      {/*
        `table-fixed` with a declared width per column: a 70-character product
        name used to take 739px of the 1182 available. Now the column decides,
        not the name — and the reader can drag the edge if they want more.
      */}
      <InventoryTable
        tableKey={TABLE_KEY}
        columns={columns}
        loading={loading}
        skeletonRows={skeletonRows}
        stale={stale}
      >
        {products.map((p) => {
          const archived = p.status === InventoryStatus.ARCHIVED;
          return (
            <TableRow
              key={p.id}
              className={cn(INVENTORY_ROW, "cursor-pointer", archived && "opacity-55")}
              onClick={() => onEdit(p)}
            >
              {columns.map((c) => (
                <Cell
                  key={c.id}
                  column={c.id as ColumnId}
                  product={p}
                  archived={archived}
                  costPending={showCost === "pending"}
                  menu={actions.menu}
                  onEdit={onEdit}
                  onStock={onStock}
                />
              ))}
            </TableRow>
          );
        })}
      </InventoryTable>
      {actions.dialog}
    </>
  );
}

/* Under fixed layout a cell that doesn't clip doesn't widen its column — it
   spills over the next one. So every cell truncates or hides overflow. */
function Cell({
  column,
  product: p,
  archived,
  costPending,
  menu,
  onEdit,
  onStock,
}: {
  column: ColumnId;
  product: Product;
  archived: boolean;
  costPending: boolean;
  menu: (product: Product) => ReactNode;
  onEdit: (product: Product) => void;
  onStock: (product: Product) => void;
}) {
  switch (column) {
    case "productId":
      return (
        <TableCell className="truncate tabular-nums text-muted-foreground">
          {p.number ?? "—"}
        </TableCell>
      );
    case "name":
      return (
        <TableCell className="overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{p.name}</span>
            {archived ? (
              <Badge variant="outline" className="flex-none font-normal text-muted-foreground">
                Archived
              </Badge>
            ) : null}
          </div>
        </TableCell>
      );
    case "description":
      return (
        <TableCell className="truncate text-muted-foreground" title={p.description || undefined}>
          {p.description || "—"}
        </TableCell>
      );
    case "price":
      return <TableCell className="truncate tabular-nums">{formatMoney(p.priceClient)}</TableCell>;
    case "cost":
      return (
        <TableCell className="truncate tabular-nums">
          {costPending ? <Skeleton className="h-4 w-12" /> : formatMoney(p.costCompany)}
        </TableCell>
      );
    case "quantity":
      return <TableCell className="truncate tabular-nums">{p.onHand ?? 0}</TableCell>;
    case "sku":
      return <TableCell className="truncate font-mono text-xs">{p.sku}</TableCell>;
    case "category":
      return <TableCell className="truncate text-muted-foreground">{p.category || "—"}</TableCell>;
    case "actions":
      return (
        <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            <RowIconAction label={`Edit ${p.name}`} tip="Edit" onClick={() => onEdit(p)}>
              <Pencil />
            </RowIconAction>
            <RowIconAction label={`Manage stock for ${p.name}`} tip="Manage stock" onClick={() => onStock(p)}>
              <Boxes />
            </RowIconAction>
            {menu(p)}
          </div>
        </TableCell>
      );
  }
}
