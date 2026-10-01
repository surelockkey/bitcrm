"use client";

import { useRef } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { IMAGE_TYPES } from "@/features/documents/schemas";
import { useUploadAsset } from "@/features/documents/hooks";

/**
 * Workiz's "Upload Image" circle on a proposal option: the cover the client
 * sees on the portal's good / better / best cards. Uploads to storage, then
 * saves the asset id on the estimate; the × clears it.
 */
export function EstimateCoverField({
  coverUrl,
  onChange,
  disabled,
  saving,
}: {
  coverUrl?: string;
  onChange: (coverAssetId: string | null) => void;
  disabled?: boolean;
  saving?: boolean;
}) {
  const upload = useUploadAsset();
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = upload.isPending || saving;

  const pick = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: (assetId) => onChange(assetId),
      onError: (e) => toast.error(getApiErrorMessage(e, "Image upload failed")),
    });
  };

  return (
    <div className="relative flex-none">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
        aria-label={coverUrl ? "Change cover image" : "Upload cover image"}
        className={cn(
          "flex size-28 items-center justify-center overflow-hidden rounded-full bg-foreground text-center text-sm font-semibold text-background",
          !disabled && "hover:bg-foreground/90",
          disabled && "cursor-default",
        )}
      >
        {busy ? (
          <Loader2 className="size-5 animate-spin" aria-hidden />
        ) : coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL
          <img src={coverUrl} alt="Cover" className="size-full object-cover" />
        ) : (
          <span className="px-3 leading-tight">
            Upload
            <br />
            Image
          </span>
        )}
      </button>
      {!disabled ? (
        coverUrl ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label="Remove cover image"
            className="absolute -right-1 bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted text-foreground shadow-sm hover:bg-destructive hover:text-white"
          >
            <X className="size-4" />
          </button>
        ) : (
          <span
            aria-hidden
            className="pointer-events-none absolute -right-1 bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm"
          >
            <Plus className="size-4" />
          </span>
        )
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        className="sr-only"
        aria-label="Cover image file"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
