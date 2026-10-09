"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Product } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzItemImagePlaceholder } from "@/components/workiz/item-image";
import { WzEditIcon, WzStockIcon } from "@/components/workiz/icons";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { displaySku } from "@/features/inventory/item-edit/item-form";
import { RowIconAction } from "@/features/inventory/components/row-icon-action";
import { categoryLeaf } from "@/features/price-book/lib";
import type { ProductWithMedia } from "../lib";
import { wzAmount } from "../items-view";
import { ProductThumb } from "./product-thumb";
import { ProductPhotoDialog } from "./product-photo-dialog";

/** The list's own key: its page size (and, with `-wz`, its column widths) are saved under it. */
export const PRODUCTS_TABLE_KEY = "inventory-items";

type BaseColumn = "productId" | "name" | "description" | "price" | "cost" | "quantity" | "sku" | "category" | "brand";

/**
 * Workiz's Inventory grid (pg_inventory_wz_01_inventory), its columns in its
 * order and words: Product ID · Name · Description · Price · Cost · Quantity
 * · SKU · Category · Brand, then one per item custom field, then Actions.
 * Every column is react-table's 100px; Actions 130. Workiz's Product ID is
 * 100px too and cuts the number to "35"; ours is wide enough for the picture,
 * its 20px and a five-digit number.
 */
export const ITEM_BASE_COLUMNS: { id: BaseColumn; label: string; width: number }[] = [
  { id: "productId", label: "Product ID", width: 150 },
  { id: "name", label: "Name", width: 100 },
  { id: "description", label: "Description", width: 100 },
  { id: "price", label: "Price", width: 100 },
  { id: "cost", label: "Cost", width: 100 },
  { id: "quantity", label: "Quantity", width: 100 },
  { id: "sku", label: "SKU", width: 100 },
  { id: "category", label: "Category", width: 100 },
  { id: "brand", label: "Brand", width: 100 },
];

/** A custom field's column — react-table's 100px. */
const FIELD_WIDTH = 100;
/** The two glyphs, 15px apart, in 20px of padding each side. */
const ACTIONS = { id: "actions", label: "Actions", width: 130 } as const;

/** The column ids and their starting widths, custom fields included. */
export function itemColumnWidths(customFields: readonly string[], showCost: boolean): Record<string, number> {
  return Object.fromEntries([
    ...ITEM_BASE_COLUMNS.filter((c) => showCost || c.id !== "cost").map((c) => [c.id, c.width] as const),
    ...customFields.map((name) => [`field:${name}`, FIELD_WIDTH] as const),
    [ACTIONS.id, ACTIONS.width] as const,
  ]);
}

/** Rows have no identity of their own while there are none. */
const NO_ROWS: Product[] = [];

/** Workiz's cells cut a long word with "…" at the cell's edge. */
function Cut({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="block truncate" title={title}>
      {children}
    </span>
  );
}

export function ProductsTable({
  products,
  showCost,
  brandNames,
  customFields,
  onEdit,
  onStock,
  loading = false,
  stale = false,
  footer,
}: {
  products: Product[];
  /**
   * Company cost is money: only for `financials.view`. `"pending"` while the
   * permissions load — the column keeps its place and its cells wait, so it
   * neither appears late nor shows money it may not.
   */
  showCost: boolean | "pending";
  /** Brand id → name, from the brands catalog. */
  brandNames: Map<string, string>;
  /** The item custom fields, a column each after Brand. */
  customFields: readonly string[];
  onEdit: (product: Product, event?: WzRowOpenEvent) => void;
  onStock: (product: Product) => void;
  /** First load: the header and Workiz's loader. */
  loading?: boolean;
  /** The previous filter's rows, dimmed, while the new ones load. */
  stale?: boolean;
  /** The pager, inside the frame under the rows. */
  footer?: ReactNode;
}) {
  // The photo opened from a picture — over the list, not the item's popup.
  const [photo, setPhoto] = useState<ProductWithMedia | null>(null);
  const defaults = useMemo(() => itemColumnWidths(customFields, showCost !== false), [customFields, showCost]);
  const { widthOf, setWidth, reset } = useColumnWidths(`${PRODUCTS_TABLE_KEY}-wz`, defaults);

  const columns = useMemo<WzReportColumn<Product>[]>(() => {
    const cell: Record<BaseColumn, (p: Product) => ReactNode> = {
      // Workiz's imageAndIdWrapper: the 40px picture, 20px, the number at the top of its 40px box.
      productId: (p) => (
        <div className="flex items-center gap-5">
          <ProductThumb product={p} onOpen={setPhoto} placeholder={<WzItemImagePlaceholder />} />
          <span className="block h-10 leading-4 tabular-nums">{p.number ?? ""}</span>
        </div>
      ),
      name: (p) => <Cut title={p.name}>{p.name}</Cut>,
      description: (p) => <Cut title={p.description || undefined}>{p.description ?? ""}</Cut>,
      price: (p) => <Cut>{wzAmount(p.priceClient)}</Cut>,
      cost: (p) => (showCost === "pending" ? <Skeleton className="h-4 w-12" /> : <Cut>{wzAmount(p.costCompany)}</Cut>),
      quantity: (p) => <Cut>{wzAmount(p.onHand)}</Cut>,
      sku: (p) => <Cut>{displaySku(p)}</Cut>,
      category: (p) => <Cut>{categoryLeaf(p.category)}</Cut>,
      brand: (p) => <Cut>{(p.brandId && brandNames.get(p.brandId)) || ""}</Cut>,
    };
    return [
      ...ITEM_BASE_COLUMNS.filter((c) => showCost !== false || c.id !== "cost").map((c) => ({
        id: c.id,
        label: c.label,
        cell: cell[c.id],
      })),
      ...customFields.map((name) => ({
        id: `field:${name}`,
        label: name,
        cell: (p: Product) => <Cut title={p.customAttributes?.[name]}>{p.customAttributes?.[name] ?? ""}</Cut>,
      })),
      {
        id: ACTIONS.id,
        label: ACTIONS.label,
        // The glyphs open popups over the row; their clicks must not reach it.
        cell: (p: Product) => (
          <div className="flex items-center gap-[15px]" onClick={(e) => e.stopPropagation()}>
            <RowIconAction label={`Edit ${p.name}`} tip="Edit" onClick={() => onEdit(p)}>
              <WzEditIcon />
            </RowIconAction>
            <RowIconAction label={`Manage stock for ${p.name}`} tip="Stock" onClick={() => onStock(p)}>
              <WzStockIcon />
            </RowIconAction>
          </div>
        ),
      },
    ];
  }, [brandNames, customFields, showCost, onEdit, onStock]);

  const minTableWidth = columns.reduce((sum, c) => sum + widthOf(c.id), 0);

  return (
    <>
      <WzReportGrid
        aria-label="Inventory"
        className="shrink-0"
        columns={columns}
        rows={loading ? NO_ROWS : products}
        rowKey={(p) => p.id}
        // Workiz's grid opens in its own order with no sort bar; the server pages one order.
        sort={null}
        resize={{ widthOf, setWidth, reset }}
        minTableWidth={minTableWidth}
        stickyHeader={false}
        onRowClick={(p, e) => onEdit(p, e)}
        loading={loading}
        busy={stale}
        plainFiller
        footer={footer}
      />
      <ProductPhotoDialog product={photo} onOpenChange={(open) => (open ? undefined : setPhoto(null))} />
    </>
  );
}
