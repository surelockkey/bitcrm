"use client";

import { ImageOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useProduct, useProductPhoto } from "../hooks";
import type { ProductWithMedia } from "../lib";

/**
 * An item's photo, full size, over the list — opened from its thumbnail.
 * Open while `product` is set.
 *
 * The photo is the item's `photoUrl`; an older server sends none, and then it
 * comes from `GET /inventory/products/:id/photo`. The frame is square from the
 * first frame, so the popup doesn't grow when the picture lands.
 */
export function ProductPhotoDialog({
  product,
  onOpenChange,
}: {
  product: ProductWithMedia | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        {product ? <Photo product={product} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Photo({ product }: { product: ProductWithMedia }) {
  const item = useProduct(product.id);
  const full = (item.data as ProductWithMedia | undefined)?.photoUrl;
  // The route only when the item has answered without a photoUrl.
  const route = useProductPhoto(product.id, !!item.data && !full && !!(item.data.photoKey ?? product.photoKey));
  const src = full ?? route.data?.downloadUrl;
  const failed = item.isError || route.isError;

  return (
    <>
      {/* Right padding keeps the title clear of the close button. */}
      <DialogHeader className="border-b px-4 py-3 pr-12">
        <DialogTitle className="truncate text-base">{product.name}</DialogTitle>
        <DialogDescription className="sr-only">The item&apos;s photo, full size.</DialogDescription>
      </DialogHeader>
      <div data-testid="photo-frame" className="grid aspect-square max-h-[calc(100dvh-8rem)] w-full place-items-center bg-muted">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL
          <img src={src} alt={product.name} decoding="async" className="size-full object-contain" />
        ) : failed ? (
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="size-6" />
            Couldn&apos;t load the photo.
          </div>
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </div>
    </>
  );
}
