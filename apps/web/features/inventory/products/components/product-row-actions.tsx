"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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

export function ProductRowActions({ product }: { product: Product }) {
  const router = useRouter();
  const { can } = usePermissions();
  const archive = useArchiveProduct();
  const reactivate = useReactivateProduct();
  const [confirm, setConfirm] = useState(false);

  const isActive = product.status === InventoryStatus.ACTIVE;
  const canEdit = can("products", "edit");
  const canArchive = can("products", "delete");

  return (
    <>
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
        <DropdownMenuContent
          align="end"
          className="w-40"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenuItem onClick={() => router.push(`/inventory/products/${product.id}`)}>
            <Pencil />
            {canEdit ? "Edit" : "View"}
          </DropdownMenuItem>
          {isActive
            ? canArchive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}>
                    <Archive />
                    Archive
                  </DropdownMenuItem>
                </>
              )
            : canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => reactivate.mutate(product.id)}>
                    <RotateCcw />
                    Restore
                  </DropdownMenuItem>
                </>
              )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive “{product.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              It stays in past deals but is hidden from pickers and new jobs. You
              can restore it later from the Archived filter.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => archive.mutate(product.id)}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
