"use client";

import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import type { Container } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useContainerStockView } from "../hooks";
import { containerTitle } from "../lib";

export function ContainersTable({ containers }: { containers: Container[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Items</TableHead>
            <TableHead className="w-32 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {containers.map((c) => (
            <ContainerRow key={c.id} container={c} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ContainerRow({ container: c }: { container: Container }) {
  const router = useRouter();
  const { summary, isLoading } = useContainerStockView(c.id);
  const inactive = c.status === InventoryStatus.ARCHIVED;

  return (
    <TableRow
      className={cn("cursor-pointer", inactive && "opacity-55")}
      onClick={() => router.push(`/inventory/containers/${c.id}`)}
    >
      <TableCell>
        <div className="font-medium">{containerTitle(c)}</div>
        {!isLoading && summary.lowCount > 0 ? (
          <Badge
            variant="outline"
            className="mt-1 gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
          >
            Low stock
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="max-w-[340px] truncate text-sm text-muted-foreground">
        {c.department || "—"}
      </TableCell>
      <TableCell className="tabular-nums">
        {isLoading ? (
          <Skeleton className="h-4 w-12" />
        ) : (
          summary.totalUnits.toLocaleString()
        )}
      </TableCell>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="View stock"
            onClick={() => router.push(`/inventory/containers/${c.id}`)}
          >
            <Package />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
