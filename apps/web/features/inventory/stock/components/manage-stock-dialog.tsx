"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Workiz's "Manage stock" popup for one item: its totals and every location
 * holding it, with add / move / return per location.
 *
 * Only the shell for now — the Items tab already opens it (`?stock=<id>`) and
 * the next stage fills in the body behind these same props.
 */
export function ManageStockDialog({
  productId,
  open,
  onOpenChange,
}: {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl" data-product-id={productId}>
        <DialogHeader>
          <DialogTitle>Manage stock</DialogTitle>
          <DialogDescription>Stock by location is on its way.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
