"use client";

import { useMemo, useState } from "react";
import { Search, TriangleAlert, Warehouse as WarehouseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { InventoryStatus } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useWarehouses } from "../hooks";
import { WarehouseCard } from "./warehouse-card";
import { WarehouseCreateDialog } from "./warehouse-create-dialog";

export function WarehousesPage() {
  const { can } = usePermissions();
  const query = useWarehouses();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>(InventoryStatus.ACTIVE);
  const [createOpen, setCreateOpen] = useState(false);

  const warehouses = useMemo(() => query.data?.data ?? [], [query.data]);

  const visible = warehouses.filter((w) => {
    if (status !== "all" && w.status !== status) return false;
    if (!search) return true;
    const hay = `${w.name} ${w.address ?? ""}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  if (!can("warehouses", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view warehouses.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Warehouses</h1>
          <p className="text-sm text-muted-foreground">
            Physical stock locations. Receive from suppliers, issue to technician containers.
          </p>
        </div>
        {can("warehouses", "create") ? (
          <Button variant="brand" className="h-9 gap-1.5 px-3.5" onClick={() => setCreateOpen(true)}>
            <WarehouseIcon className="size-4" />
            New warehouse
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search warehouses"
            className="h-9 pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value={InventoryStatus.ACTIVE}>Active</SelectItem>
            <SelectItem value={InventoryStatus.ARCHIVED}>Archived</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "warehouse" : "warehouses"}
        </span>
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load warehouses</div>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <WarehouseIcon className="size-6" />
            </div>
            <div>
              <div className="font-medium">
                {warehouses.length ? "No warehouses match" : "No warehouses yet"}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {warehouses.length
                  ? "Try clearing your search or filter."
                  : "Create your first warehouse to start receiving stock."}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2">
            {visible.map((w) => (
              <WarehouseCard key={w.id} warehouse={w} />
            ))}
          </div>
        )}
      </div>

      <WarehouseCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
