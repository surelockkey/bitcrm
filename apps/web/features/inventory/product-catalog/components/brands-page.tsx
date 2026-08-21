"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Search, Tag } from "lucide-react";
import { InventoryStatus, type Brand } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useBrands, useToggleBrand } from "../hooks";
import { searchBrands } from "../lib";
import { BrandFormDialog } from "./brand-form-dialog";

export function BrandsPage() {
  const { can } = usePermissions();
  const { data: brands, isLoading } = useBrands();
  const toggle = useToggleBrand();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | undefined>();

  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");

  const rows = useMemo(() => searchBrands(brands, search), [brands, search]);

  if (!can("products", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view the product catalog.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Brands</h2>
          <p className="text-sm text-muted-foreground">
            Who makes the parts you stock. A product picks one brand.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New brand
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          placeholder="Search brands…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search brands"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !brands || brands.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Tag className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No brands yet</p>
          <p className="text-sm text-muted-foreground">
            Add the manufacturers you buy from so products can be filed under them.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">
          No brand matches &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Brand name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((brand) => {
                const active = brand.status === InventoryStatus.ACTIVE;
                return (
                  <TableRow key={brand.id}>
                    <TableCell className="font-medium">{brand.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {brand.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={active ? "default" : "secondary"}>
                        {active ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={toggle.isPending}
                            aria-label={`${active ? "Disable" : "Enable"} ${brand.name}`}
                            onClick={() => toggle.mutate({ id: brand.id, active: !active })}
                          >
                            {active ? "Disable" : "Enable"}
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Edit ${brand.name}`}
                            onClick={() => {
                              setEditing(brand);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {formOpen ? (
        <BrandFormDialog
          key={editing?.id ?? "new"}
          brand={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}
    </div>
  );
}
