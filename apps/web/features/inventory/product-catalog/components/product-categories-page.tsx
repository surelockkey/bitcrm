"use client";

import { useMemo, useState } from "react";
import { FolderTree, Loader2, Pencil, Plus, Search } from "lucide-react";
import { InventoryStatus, type ProductCategoryWithCounts } from "@bitcrm/types";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePermissions } from "@/features/auth/use-permissions";
import { useProductCategories, useToggleProductCategory } from "../hooks";
import { buildCategoryTree, searchCategories } from "../lib";
import { ProductCategoryFormDialog } from "./product-category-form-dialog";

export function ProductCategoriesPage() {
  const { can } = usePermissions();
  const { data: categories, isLoading } = useProductCategories();
  const toggle = useToggleProductCategory();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCategoryWithCounts | undefined>();
  const [disabling, setDisabling] = useState<ProductCategoryWithCounts | undefined>();

  const canCreate = can("products", "create");
  const canEdit = can("products", "edit");
  const canDisable = can("products", "delete");

  const rows = useMemo(
    () => buildCategoryTree(searchCategories(categories, search)),
    [categories, search],
  );

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Categories</h2>
          <p className="text-sm text-muted-foreground">
            How your products are filed. A category can sit under another one.
          </p>
        </div>
        {canCreate ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" /> New category
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          placeholder="Search categories…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search categories"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !categories || categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <FolderTree className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No categories yet</p>
          <p className="text-sm text-muted-foreground">
            Create the groups your products fall into — locks, keys, hardware.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">
          No category matches &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category name</TableHead>
                <TableHead>Parent category</TableHead>
                <TableHead className="w-24">Items</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((category) => {
                const active = category.status === InventoryStatus.ACTIVE;
                return (
                  <TableRow key={category.id}>
                    <TableCell className="font-medium">
                      <span
                        data-testid="category-name"
                        className="inline-block"
                        style={{ paddingLeft: category.depth * 20 }}
                      >
                        {category.name}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {category.parentName || "—"}
                    </TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {category.activeItemCount}
                    </TableCell>
                    <TableCell>
                      <Badge variant={active ? "default" : "secondary"}>
                        {active ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canDisable ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={toggle.isPending}
                            aria-label={`${active ? "Disable" : "Enable"} ${category.name}`}
                            onClick={() =>
                              active
                                ? setDisabling(category)
                                : toggle.mutate({
                                    id: category.id,
                                    active: true,
                                    name: category.name,
                                  })
                            }
                          >
                            {active ? "Disable" : "Enable"}
                          </Button>
                        ) : null}
                        {canEdit ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Edit ${category.name}`}
                            onClick={() => {
                              setEditing(category);
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
        <ProductCategoryFormDialog
          key={editing?.id ?? "new"}
          category={editing}
          categories={categories ?? []}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      {/* Disabling cascades down the tree, so it asks first — enabling doesn't. */}
      <AlertDialog
        open={Boolean(disabling)}
        onOpenChange={(v) => !v && setDisabling(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disable &ldquo;{disabling?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This will also disable all subcategories and the items filed under them. They
              leave the product pickers; nothing is deleted, and you can enable it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!disabling) return;
                toggle.mutate(
                  { id: disabling.id, active: false, name: disabling.name },
                  { onSuccess: () => setDisabling(undefined) },
                );
              }}
            >
              {toggle.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Disable category"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
