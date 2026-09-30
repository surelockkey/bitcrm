"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductWithMedia } from "../lib";

/** Workiz's thumbnail: 40×40, rounded — the size is fixed, so nothing moves when it loads. */
const BOX = "grid size-10 flex-none place-items-center overflow-hidden rounded-md border bg-muted text-muted-foreground";

/**
 * An item's photo in its list row: the server's thumbnail, loaded lazily at
 * a fixed size, or a grey image icon when there is none (or it fails to
 * load). A click opens the photo itself — and stops there: the row under it
 * opens the item's Edit popup.
 *
 * An item with a photo but no thumbnail yet (an older server, or one not
 * made yet) still opens its photo from the placeholder.
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
    // eslint-disable-next-line @next/next/no-img-element -- a presigned S3 URL, already small
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
    <ImageIcon className="size-4" />
  );

  if (!hasPhoto) {
    return (
      <span data-testid="photo-placeholder" aria-hidden className={BOX}>
        {face}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={`View photo of ${product.name}`}
      className={cn(BOX, "cursor-zoom-in outline-none focus-visible:ring-3 focus-visible:ring-ring/50")}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(product);
      }}
    >
      {url ? face : <span data-testid="photo-placeholder" className="contents">{face}</span>}
    </button>
  );
}
