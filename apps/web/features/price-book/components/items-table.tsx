"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Product } from "@bitcrm/types";
import { WzItemImagePlaceholder } from "@/components/workiz/item-image";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { formatMoney, type ProductWithMedia } from "@/features/inventory/products/lib";
import { ProductThumb } from "@/features/inventory/products/components/product-thumb";
import { ProductPhotoDialog } from "@/features/inventory/products/components/product-photo-dialog";
import { displaySku } from "@/features/inventory/item-edit/item-form";
import { bookingLabel, categoryLeaf, inventoryLabel, itemTypeLabel, taxableLabel } from "../lib";

type ColumnId =
  | "id"
  | "name"
  | "description"
  | "price"
  | "cost"
  | "type"
  | "category"
  | "model"
  | "brand"
  | "booking"
  | "inventory"
  | "taxable";

/**
 * Workiz's Price book grid (pg_pricebook_wz_01_default_scroll1), its columns
 * in its order and words. Its row checkbox is left out — BitCRM has no bulk
 * price-book actions. Id is 195px (the picture, 20px, the number); the rest
 * share the row as react-table's `flex: 100` columns do (≈109px at 1400).
 * Model # is the SKU, as Workiz calls it in its price book.
 */
const COLUMNS: { id: ColumnId; label: string; width: number }[] = [
  { id: "id", label: "Id", width: 195 },
  { id: "name", label: "Name", width: 109 },
  { id: "description", label: "Description", width: 109 },
  { id: "price", label: "Price", width: 109 },
  { id: "cost", label: "Cost", width: 109 },
  { id: "type", label: "Type", width: 109 },
  { id: "category", label: "Category", width: 109 },
  { id: "model", label: "Model #", width: 109 },
  { id: "brand", label: "Brand", width: 109 },
  { id: "booking", label: "Booking", width: 109 },
  { id: "inventory", label: "Inventory", width: 109 },
  { id: "taxable", label: "Taxable", width: 109 },
];

const WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width])) as Record<ColumnId, number>;

/** The list's own key: the name its page size and column widths are saved under. */
export const ITEMS_TABLE_KEY = "price-book-items";

/** Rows have no identity of their own while there are none. */
const NO_ROWS: Product[] = [];

/**
 * The Items & products grid: Workiz's react-table, 80px rows with every word
 * on the middle (its rt-td is a centred flex box), cut at the cell's edge
 * without "…"; the whole row opens Workiz's "Edit Item"; the picture opens
 * the photo. `footer` is the pager, inside the frame as `.pagination-bottom`.
 */
export function ItemsTable({
  items,
  showCost,
  brandNames,
  onOpen,
  loading = false,
  stale = false,
  footer,
}: {
  items: Product[];
  /** Company cost is money: only for `financials.view`. */
  showCost: boolean;
  /** Brand id → name, from the brands catalog. */
  brandNames: Map<string, string>;
  onOpen: (item: Product, event: WzRowOpenEvent) => void;
  loading?: boolean;
  /** The previous filter's rows, dimmed, while the new ones load. */
  stale?: boolean;
  footer?: ReactNode;
}) {
  // The photo opened from a picture — over the list, not the item's popup.
  const [photo, setPhoto] = useState<ProductWithMedia | null>(null);
  const { widthOf, setWidth, reset } = useColumnWidths(`${ITEMS_TABLE_KEY}-wz`, WIDTHS);

  const columns = useMemo<WzReportColumn<Product>[]>(() => {
    const cell: Record<ColumnId, (p: Product) => ReactNode> = {
      // Workiz's `imageAndIdWrapper`: the 40px picture, 20px, then the number
      // at the top of a 40px box beside it.
      id: (p) => (
        <div className="flex items-center gap-5">
          <ProductThumb product={p} onOpen={setPhoto} placeholder={<WzItemImagePlaceholder />} />
          <span className="block h-10 leading-4">{p.number ?? ""}</span>
        </div>
      ),
      name: (p) => <span title={p.name}>{p.name}</span>,
      description: (p) => p.description?.split("\n")[0] ?? "",
      price: (p) => formatMoney(p.priceClient),
      cost: (p) => formatMoney(p.costCompany ?? 0),
      type: (p) => itemTypeLabel(p),
      category: (p) => categoryLeaf(p.category),
      model: (p) => displaySku(p),
      brand: (p) => (p.brandId && brandNames.get(p.brandId)) || "",
      booking: (p) => bookingLabel(p),
      inventory: (p) => inventoryLabel(p),
      taxable: (p) => taxableLabel(p),
    };
    return COLUMNS.filter((c) => showCost || c.id !== "cost").map((c) => ({ id: c.id, label: c.label, cell: cell[c.id] }));
  }, [brandNames, showCost]);

  return (
    <>
      <WzReportGrid
        aria-label="Items & products"
        className="shrink-0"
        columns={columns}
        rows={loading ? NO_ROWS : items}
        rowKey={(p) => p.id}
        // Workiz's grid opens in its own order with no sort bar; BitCRM's
        // server pages one order only, so the headers do not re-sort.
        sort={null}
        resize={{ widthOf, setWidth, reset }}
        cellAlign="middle"
        onRowClick={onOpen}
        loading={loading}
        busy={stale}
        plainFiller
        footer={footer}
      />
      <ProductPhotoDialog product={photo} onOpenChange={(open) => (open ? undefined : setPhoto(null))} />
    </>
  );
}
