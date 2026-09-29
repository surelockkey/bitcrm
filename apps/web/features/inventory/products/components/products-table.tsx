"use client";

import { Boxes, Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHead } from "@/components/ui/resizable-head";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMoney } from "../lib";
import { ProductRowActions } from "./product-row-actions";

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
 */
const COLUMNS: { id: ColumnId; label: string; width: number }[] = [
  { id: "productId", label: "Product ID", width: 110 },
  { id: "name", label: "Name", width: 280 },
  { id: "description", label: "Description", width: 280 },
  { id: "price", label: "Price", width: 110 },
  { id: "cost", label: "Cost", width: 110 },
  { id: "quantity", label: "Quantity", width: 100 },
  { id: "sku", label: "SKU", width: 150 },
  { id: "category", label: "Category", width: 160 },
  { id: "actions", label: "Actions", width: 130 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-items";

export function ProductsTable({
  products,
  showCost,
  onEdit,
  onStock,
}: {
  products: Product[];
  /** Company cost is money: only for `financials.view`. */
  showCost: boolean;
  onEdit: (product: Product) => void;
  onStock: (product: Product) => void;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);
  const columns = showCost ? COLUMNS : COLUMNS.filter((c) => c.id !== "cost");

  return (
    <div className="overflow-hidden border">
      {/*
        `table-fixed` with a declared width per column: a 70-character product
        name used to take 739px of the 1182 available. Now the column decides,
        not the name — and the reader can drag the edge if they want more.
      */}
      <Table className="table-fixed">
        <colgroup>
          {columns.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const archived = p.status === InventoryStatus.ARCHIVED;
            return (
              <TableRow
                key={p.id}
                className={cn("cursor-pointer", archived && "opacity-55")}
                onClick={() => onEdit(p)}
              >
                {columns.map((c) => (
                  <Cell key={c.id} column={c.id} product={p} archived={archived} onEdit={onEdit} onStock={onStock} />
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/* Under fixed layout a cell that doesn't clip doesn't widen its column — it
   spills over the next one. So every cell truncates or hides overflow. */
function Cell({
  column,
  product: p,
  archived,
  onEdit,
  onStock,
}: {
  column: ColumnId;
  product: Product;
  archived: boolean;
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
      return <TableCell className="truncate tabular-nums">{formatMoney(p.costCompany)}</TableCell>;
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
            <IconAction label={`Edit ${p.name}`} tip="Edit" onClick={() => onEdit(p)}>
              <Pencil />
            </IconAction>
            <IconAction label={`Manage stock for ${p.name}`} tip="Manage stock" onClick={() => onStock(p)}>
              <Boxes />
            </IconAction>
            <ProductRowActions product={p} />
          </div>
        </TableCell>
      );
  }
}

function IconAction({
  label,
  tip,
  onClick,
  children,
}: {
  label: string;
  tip: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={label} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
