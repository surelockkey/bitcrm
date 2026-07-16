"use client";

import { useRouter } from "next/navigation";
import { Package, Wrench } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatMargin, formatMoney, isService } from "../lib";
import { ProductTypeBadge } from "./product-type-badge";
import { ProductRowActions } from "./product-row-actions";

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

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-9">
              <Checkbox
                checked={allSelected}
                onCheckedChange={(c) => onToggleAll(c === true)}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Client price</TableHead>
            <TableHead className="text-right">Min stock</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((p) => {
            const archived = p.status === InventoryStatus.ARCHIVED;
            return (
              <TableRow
                key={p.id}
                className={cn("cursor-pointer", archived && "opacity-55")}
                onClick={() => router.push(`/inventory/products/${p.id}`)}
              >
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={() => onToggle(p.id)}
                    aria-label={`Select ${p.name}`}
                  />
                </TableCell>
                <TableCell>
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
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {p.category || "—"}
                </TableCell>
                <TableCell>
                  <ProductTypeBadge product={p} />
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-medium tabular-nums">{formatMoney(p.priceClient)}</div>
                  {isService(p) ? (
                    <div className="text-[11px] text-muted-foreground">no stock</div>
                  ) : (
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      tech {formatMoney(p.costTech)} ·{" "}
                      <span className="text-green-600 dark:text-green-500">
                        {formatMargin(p.priceClient, p.costTech)}
                      </span>
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {isService(p) ? "—" : p.minimumStockLevel}
                </TableCell>
                <TableCell>
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
                <TableCell onClick={(e) => e.stopPropagation()}>
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
