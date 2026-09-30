"use client";

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMoney, typeLabel, type ProductWithMedia } from "@/features/inventory/products/lib";
import { ProductThumb } from "@/features/inventory/products/components/product-thumb";
import { ProductPhotoDialog } from "@/features/inventory/products/components/product-photo-dialog";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { ProductRowActions } from "@/features/inventory/products/components/product-row-actions";
import { manageStockLabel, taxableLabel } from "../lib";
import { PriceBookTable, ROW_HEIGHT, type PriceBookColumn } from "./price-book-table";

type ColumnId =
  | "photo"
  | "productId"
  | "name"
  | "type"
  | "category"
  | "brand"
  | "price"
  | "cost"
  | "sku"
  | "taxable"
  | "manageStock"
  | "status"
  | "actions";

/**
 * The Price Book grid, in its order, with the width each column starts at.
 * Together they fit the ~1250px a 1600px screen leaves beside the sidebar;
 * wider than that (a dragged edge, a narrow window) the frame scrolls sideways.
 * The photo came in first, as in Workiz; the text columns gave it room.
 */
const COLUMNS: PriceBookColumn<ColumnId>[] = [
  // A 40px thumbnail and the cell's side padding; its skeleton a square in the row's height.
  { id: "photo", label: "Photo", width: 56, skeleton: "size-8 rounded-md" },
  { id: "productId", label: "Product ID", width: 90 },
  { id: "name", label: "Name", width: 172 },
  { id: "type", label: "Type", width: 90 },
  { id: "category", label: "Category", width: 110 },
  { id: "brand", label: "Brand", width: 100 },
  { id: "price", label: "Price", width: 90 },
  { id: "cost", label: "Cost", width: 90 },
  { id: "sku", label: "SKU", width: 100 },
  { id: "taxable", label: "Taxable", width: 75 },
  { id: "manageStock", label: "Manage stock", width: 102 },
  { id: "status", label: "Status", width: 90 },
  // Two 32px buttons, their gap and the cell's padding.
  { id: "actions", label: "Actions", width: 85 },
];
const COLUMNS_NO_COST = COLUMNS.filter((c) => c.id !== "cost");

/** The list's own key: the same name its page-size preference is saved under. */
export const ITEMS_TABLE_KEY = "price-book-items";

export function ItemsTable({
  items,
  showCost,
  brandNames,
  onEdit,
  loading = false,
  skeletonRows = 0,
  stale = false,
  empty,
}: {
  items: Product[];
  /** Company cost is money: only for `financials.view`. */
  showCost: boolean;
  /** Brand id → name, from the brands catalog. */
  brandNames: Map<string, string>;
  onEdit: (item: Product) => void;
  loading?: boolean;
  skeletonRows?: number;
  stale?: boolean;
  empty?: ReactNode;
}) {
  const columns = showCost ? COLUMNS : COLUMNS_NO_COST;
  // The photo opened from a thumbnail — over the list, not the item's popup.
  const [photo, setPhoto] = useState<ProductWithMedia | null>(null);

  return (
    <>
      <PriceBookTable
        tableKey={ITEMS_TABLE_KEY}
        columns={columns}
        loading={loading}
        skeletonRows={skeletonRows}
        stale={stale}
        empty={items.length === 0 ? empty : undefined}
      >
        {items.map((p) => (
          <TableRow
            key={p.id}
            className={cn(ROW_HEIGHT, "cursor-pointer", p.status === InventoryStatus.ARCHIVED && "opacity-55")}
            onClick={() => onEdit(p)}
          >
            {columns.map((c) => (
              <Cell
                key={c.id}
                column={c.id}
                item={p}
                brandNames={brandNames}
                onEdit={onEdit}
                onPhoto={setPhoto}
              />
            ))}
          </TableRow>
        ))}
      </PriceBookTable>
      <ProductPhotoDialog product={photo} onOpenChange={(open) => (open ? undefined : setPhoto(null))} />
    </>
  );
}

/* Under fixed layout a cell that doesn't clip spills over the next column,
   so every cell truncates or hides its overflow. */
function Cell({
  column,
  item: p,
  brandNames,
  onEdit,
  onPhoto,
}: {
  column: ColumnId;
  item: Product;
  brandNames: Map<string, string>;
  onEdit: (item: Product) => void;
  onPhoto: (item: ProductWithMedia) => void;
}) {
  switch (column) {
    case "photo":
      // py-1: a 40px picture in the 48px row, without growing it.
      return (
        <TableCell className="overflow-hidden py-1">
          <ProductThumb product={p} onOpen={onPhoto} />
        </TableCell>
      );
    case "productId":
      return (
        <TableCell className="truncate tabular-nums text-muted-foreground">{p.number ?? "—"}</TableCell>
      );
    case "name":
      return (
        <TableCell className="truncate font-medium" title={p.name}>
          {p.name}
        </TableCell>
      );
    case "type":
      return (
        <TableCell className="truncate">
          {typeLabel(p.type)}
          {/* Imported `other` / `hours` items are services here; keep the word Workiz had. */}
          {p.workizType ? <span className="ml-1 text-xs text-muted-foreground">({p.workizType})</span> : null}
        </TableCell>
      );
    case "category":
      return <TableCell className="truncate text-muted-foreground">{p.category || "—"}</TableCell>;
    case "brand":
      return (
        <TableCell className="truncate text-muted-foreground">
          {(p.brandId && brandNames.get(p.brandId)) || "—"}
        </TableCell>
      );
    case "price":
      return <TableCell className="truncate tabular-nums">{formatMoney(p.priceClient)}</TableCell>;
    case "cost":
      return <TableCell className="truncate tabular-nums">{formatMoney(p.costCompany ?? 0)}</TableCell>;
    case "sku":
      return <TableCell className="truncate font-mono text-xs">{p.sku}</TableCell>;
    case "taxable":
      return <TableCell className="truncate">{taxableLabel(p)}</TableCell>;
    case "manageStock":
      return <TableCell className="truncate">{manageStockLabel(p)}</TableCell>;
    case "status":
      return (
        <TableCell className="overflow-hidden">
          <StatusBadge archived={p.status === InventoryStatus.ARCHIVED} />
        </TableCell>
      );
    case "actions":
      return (
        <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            <RowIconAction label={`Edit ${p.name}`} tip="Edit" onClick={() => onEdit(p)}>
              <Pencil />
            </RowIconAction>
            <ProductRowActions product={p} />
          </div>
        </TableCell>
      );
  }
}

/** Active / Archived with a dot — the item popup's own status pill. */
export function StatusBadge({ archived }: { archived: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-normal", archived ? "text-muted-foreground" : "text-foreground")}
    >
      <span className={cn("size-1.5 rounded-full", archived ? "bg-muted-foreground/50" : "bg-green-500")} />
      {archived ? "Archived" : "Active"}
    </Badge>
  );
}
