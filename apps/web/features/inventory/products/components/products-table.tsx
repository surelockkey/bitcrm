"use client";

import { useRouter } from "next/navigation";
import { Package, Wrench } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMargin, formatMoney, isService } from "../lib";
import { ProductTypeBadge } from "./product-type-badge";
import { ProductRowActions } from "./product-row-actions";

/**
 * The columns, with the width each one starts at.
 *
 * One place, read by both the `<colgroup>` and the headers: a width written
 * twice is a width that drifts. From here on the reader owns it — the drag
 * handle writes their own into `useColumnWidths`.
 */
const COLUMNS: { id: string; label: string; width: number; className?: string }[] = [
  { id: "select", label: "Select", width: 56 },
  { id: "item", label: "Item", width: 320 },
  { id: "category", label: "Category", width: 160 },
  { id: "type", label: "Type", width: 120 },
  { id: "price", label: "Client price", width: 150, className: "text-right" },
  { id: "minStock", label: "Min stock", width: 110, className: "text-right" },
  { id: "status", label: "Status", width: 120 },
  { id: "actions", label: "Actions", width: 56 },
];

const DEFAULT_WIDTHS = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width]));

/** The list's own key: the same name its page-size preference is saved under. */
const TABLE_KEY = "inventory-items";

export function ProductsTable({
  products,
  selected,
  onToggle,
  onToggleAll,
}: {
  products: Product[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const router = useRouter();
  const allSelected = products.length > 0 && products.every((p) => selected.has(p.id));
  const { widthOf, setWidth, reset } = useColumnWidths(TABLE_KEY, DEFAULT_WIDTHS);

  return (
    <div className="overflow-hidden border">
      {/*
        `table-fixed` with a declared width per column: a 70-character product
        name used to take 739px of the 1182 available and push the checkbox
        column onto the border. Now the column decides, not the name — and the
        reader can drag the edge if they want more.
      */}
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
                className={c.className}
              >
                {c.id === "select" ? (
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(ch) => onToggleAll(ch === true)}
                    aria-label="Select all"
                  />
                ) : c.id === "actions" ? (
                  // The kebab column carries no visible heading, but the
                  // handle still needs something to be named after.
                  <span className="sr-only">Actions</span>
                ) : undefined}
              </ResizableHead>
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
                onClick={() => router.push(`/inventory/items/${p.id}`)}
              >
                <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() => onToggle(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </TableCell>
                {/* Under fixed layout a cell that doesn't clip doesn't widen
                    its column — it spills over the next one. */}
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 flex-none items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                      {isService(p) ? (
                        <Wrench className="size-4" />
                      ) : (
                        <Package className="size-4" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {p.sku}
                        {p.barcode ? ` · ${p.barcode}` : ""}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="truncate text-sm text-muted-foreground">
                  {p.category || "—"}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <ProductTypeBadge product={p} />
                </TableCell>
                <TableCell className="overflow-hidden text-right">
                  <div className="truncate font-medium tabular-nums">
                    {formatMoney(p.priceClient)}
                  </div>
                  {isService(p) ? (
                    <div className="truncate text-[11px] text-muted-foreground">no stock</div>
                  ) : (
                    <div className="truncate text-[11px] text-muted-foreground tabular-nums">
                      tech {formatMoney(p.costTech)} ·{" "}
                      <span className="text-green-600 dark:text-green-500">
                        {formatMargin(p.priceClient, p.costTech)}
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="truncate text-right tabular-nums text-muted-foreground">
                  {isService(p) ? "—" : p.minimumStockLevel}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <Badge
                    variant="outline"
                    className={cn(
                      "gap-1.5 font-normal",
                      archived ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        archived ? "bg-muted-foreground/50" : "bg-green-500",
                      )}
                    />
                    {archived ? "Archived" : "Active"}
                  </Badge>
                </TableCell>
                <TableCell className="overflow-hidden" onClick={(e) => e.stopPropagation()}>
                  <ProductRowActions product={p} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
