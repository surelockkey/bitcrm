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

  // pg_estimate_wz_01_job (`headerJob-module__img` / `__uploadIcon`): a 100px
  // #3b4b52 disc, "Upload Image" in white, the 32px yellow + 72px in and 60px down.
  return (
    <div className="relative flex-none">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => fileRef.current?.click()}
        aria-label={coverUrl ? "Change cover image" : "Upload cover image"}
        className={cn(
          "flex size-[100px] items-center justify-center overflow-hidden rounded-full bg-foreground text-center text-[13px] leading-[18px] font-semibold text-white",
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
          // Workiz's `clearImage`: a 22px #ff6f64 disc with a white ×.
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={busy}
            aria-label="Remove cover image"
            className="absolute top-0 left-[78px] flex size-[22px] items-center justify-center rounded-full bg-[#ff6f64] text-white hover:bg-wz-danger-hover"
          >
            <X className="size-3.5" strokeWidth={2.5} />
          </button>
        ) : (
          <span
            aria-hidden
            className="pointer-events-none absolute top-[60px] left-[72px] flex size-8 items-center justify-center rounded-full bg-primary text-foreground"
          >
            <Plus className="size-4" strokeWidth={1.75} />
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
