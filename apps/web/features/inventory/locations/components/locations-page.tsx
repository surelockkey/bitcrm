"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search, Truck, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/features/auth/use-permissions";
import { useLocations } from "../hooks";
import { searchLocations, type LocationRow } from "../lib";
import { ManageStockDialog } from "./manage-stock-dialog";

/**
 * Every place stock can sit, in one table — the shop's warehouses and the
 * technicians' vans together, the way Workiz lists them.
 */
export function LocationsPage() {
  const { can } = usePermissions();
  const { rows: all, isLoading } = useLocations();
  const [search, setSearch] = useState("");
  const [managing, setManaging] = useState<LocationRow | undefined>();

  const canManage = can("transfers", "create") || can("warehouses", "edit");
  const rows = useMemo(() => searchLocations(all, search), [all, search]);

  if (!can("warehouses", "view") && !can("containers", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view inventory locations.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Locations</h1>
          <p className="text-sm text-muted-foreground">
            Warehouses and technician vans — everywhere stock can sit.
          </p>
        </div>
        <Button asChild variant="outline" className="h-9 gap-1.5">
          <Link href="/inventory/transfers">
            Item movement
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search locations…"
            aria-label="Search locations"
          />
        </div>
      </div>

      <div className="px-6 pb-6">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">
            {all.length === 0
              ? "No locations yet. Warehouses are created in settings; vans appear as technicians are activated."
              : `No location matches “${search}”.`}
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-48 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={`${row.kind}-${row.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {row.kind === "warehouse" ? (
                          <Warehouse className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <Truck className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <Link href={row.href} className="font-medium hover:underline">
                          {row.name}
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.description || "—"}
                    </TableCell>
                    <TableCell>
                      {/* Workiz prefixes the name with "N/A "; we keep the name
                          clean and say it in a badge. */}
                      {row.active ? (
                        <Badge variant="secondary">In use</Badge>
                      ) : (
                        <Badge variant="outline">Not in use</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {canManage ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          aria-label={`Manage stock for ${row.name}`}
                          onClick={() => setManaging(row)}
                        >
                          Manage stock
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {managing ? (
        <ManageStockDialog
          key={`${managing.kind}-${managing.id}`}
          location={managing}
          open
          onOpenChange={(v) => !v && setManaging(undefined)}
        />
      ) : null}
    </div>
  );
}
