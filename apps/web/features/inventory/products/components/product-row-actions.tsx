"use client";

import { useState, type ReactNode } from "react";
import { Archive, MoreHorizontal, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Button } from "@/components/ui/button";
import { InventoryStatus } from "@bitcrm/types";
import type { Product } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useArchiveProduct, useReactivateProduct } from "../hooks";

/**
 * The kebab's permissions, mutations and its one confirm dialog — held once
 * for a whole table. Per row, a hundred rows were a hundred subscriptions to
 * the current user, two hundred mutations and a hundred dialogs.
 */
export function useProductRowActions(): { menu: (product: Product) => ReactNode; dialog: ReactNode } {
  const { can } = usePermissions();
  const archive = useArchiveProduct();
  const reactivate = useReactivateProduct();
  const [confirming, setConfirming] = useState<Product | null>(null);

  const canEdit = can("products", "edit");
  const canArchive = can("products", "delete");

  const menu = (product: Product) => (
    <ProductRowMenu
      product={product}
      canEdit={canEdit}
      canArchive={canArchive}
      onArchive={setConfirming}
      onRestore={(p) => reactivate.mutate(p.id)}
    />
  );

  const dialog = (
    <AlertDialog open={confirming !== null} onOpenChange={(open) => (open ? undefined : setConfirming(null))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive “{confirming?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            It stays in past jobs but is hidden from pickers and new jobs. You
            can restore it later from the Archived filter.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() => {
              if (confirming) archive.mutate(confirming.id);
            }}
          >
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { menu, dialog };
}

/** The kebab on its own — for one item outside a table. */
export function ProductRowActions({ product }: { product: Product }) {
  const { menu, dialog } = useProductRowActions();
  return (
    <>
      {menu(product)}
      {dialog}
    </>
  );
}

/** The kebab: Archive / Restore. Edit and stock have their own buttons beside it. */
function ProductRowMenu({
  product,
  canEdit,
  canArchive,
  onArchive,
  onRestore,
}: {
  product: Product;
  canEdit: boolean;
  canArchive: boolean;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
}) {
  const isActive = product.status === InventoryStatus.ACTIVE;

  // A kebab that opens onto nothing is worse than no kebab.
  if (isActive ? !canArchive : !canEdit) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Row actions"
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40" onClick={(e) => e.stopPropagation()}>
        {isActive ? (
          <DropdownMenuItem variant="destructive" onClick={() => onArchive(product)}>
            <Archive />
            Archive
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onRestore(product)}>
            <RotateCcw />
            Restore
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
