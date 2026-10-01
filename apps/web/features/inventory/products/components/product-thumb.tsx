"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductWithMedia } from "../lib";

/**
 * Workiz's picture in an item row, as measured on its Inventory and Price Book
 * tables: 40×40, 8px corners, a hairline border, the photo cut to fill it.
 * The size is fixed, so nothing moves when the picture loads.
 */
const BOX =
  "grid size-10 flex-none place-items-center overflow-hidden rounded-lg border-[0.5px] border-border bg-muted text-muted-foreground";

/**
 * An item's photo in its list row: the server's thumbnail (`thumbnailUrl`, a
 * 128px webp), loaded lazily — or Workiz's grey picture placeholder when there
 * is none or it fails to load.
 *
 * A click on the photo opens it larger, as in Workiz, and stops there: the
 * row under it opens the item's Edit popup. A click on the placeholder of an
 * item without a photo does nothing — Workiz's doesn't either. An item whose
 * photo has no thumbnail yet (made after upload; older photos by the
 * backfill) still opens its photo from the placeholder.
 */
export function ProductThumb({
  product,
  onOpen,
}: {
  product: ProductWithMedia;
  onOpen: (product: ProductWithMedia) => void;
}) {
  // The URL that failed, not a flag: the next hour's URL gets its own chance.
  const [failed, setFailed] = useState<string | null>(null);
  const url = product.thumbnailUrl && product.thumbnailUrl !== failed ? product.thumbnailUrl : null;
  const hasPhoto = !!product.thumbnailUrl || !!product.photoKey;

  const face = url ? (
    // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL, already 128px
    <img
      src={url}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      className="size-full object-cover"
      onError={() => setFailed(url)}
    />
  ) : (
    <ImageIcon className="size-5" strokeWidth={1.5} />
  );

  if (!hasPhoto) {
    return (
      <span data-testid="photo-placeholder" aria-hidden className={BOX} onClick={(e) => e.stopPropagation()}>
        {face}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`View photo of ${product.name}`}
      className={cn(BOX, "cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(product);
      }}
    >
      {url ? face : <span data-testid="photo-placeholder" className="contents">{face}</span>}
    </button>
  );
}
