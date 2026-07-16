"use client";

import { useRef } from "react";
import { ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Product } from "@bitcrm/types";
import { useProductPhoto, useUploadPhoto, useRemovePhoto } from "../hooks";

export function ProductPhotoPanel({ product }: { product: Product }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: photo, isLoading } = useProductPhoto(product.id, !!product.photoKey);
  const upload = useUploadPhoto();
  const remove = useRemovePhoto();

  return (
    <div className="flex items-center gap-4">
      <div className="grid size-24 flex-none place-items-center overflow-hidden rounded-lg border bg-muted text-muted-foreground">
        {product.photoKey && photo?.downloadUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.downloadUrl} alt={product.name} className="size-full object-cover" />
        ) : isLoading && product.photoKey ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <ImageIcon className="size-6" />
        )}
      </div>
      <div className="flex flex-col items-start gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate({ id: product.id, file: f });
            e.target.value = "";
          }}
        />
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={upload.isPending}
            onClick={() => inputRef.current?.click()}
          >
            {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {product.photoKey ? "Replace" : "Upload"}
          </Button>
          {product.photoKey ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(product.id)}
            >
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">JPG or PNG, up to 5MB.</p>
      </div>
    </div>
  );
}
