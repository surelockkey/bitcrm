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
import { useProductPhoto } from "../hooks";
import type { ProductWithMedia } from "../lib";

/**
 * An item's photo, larger, over the list — opened from its thumbnail. Workiz
 * draws it as a 500px "Item" popup: the title, the close button, the photo
 * whole inside a square frame. Open while `product` is set.
 *
 * The photo is `GET /inventory/products/:id/photo` — one request; the frame is
 * square from the first frame, so the popup doesn't grow when the photo lands.
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
      <DialogContent className="gap-4 p-6 sm:max-w-[500px]">
        {product ? <Photo product={product} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Photo({ product }: { product: ProductWithMedia }) {
  const photo = useProductPhoto(product.id, !!product.photoKey);
  const src = photo.data?.downloadUrl;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Item</DialogTitle>
        <DialogDescription className="sr-only">{product.name}</DialogDescription>
      </DialogHeader>
      <div
        data-testid="photo-frame"
        className="grid aspect-square max-h-[calc(100dvh-10rem)] w-full place-items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-background"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL
          <img src={src} alt={product.name} decoding="async" className="size-full object-contain" />
        ) : photo.isError || !product.photoKey ? (
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
