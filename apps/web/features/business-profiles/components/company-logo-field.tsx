"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api/errors";
import { IMAGE_TYPES } from "@/features/documents/schemas";
import { useLogoUpload } from "../hooks";

interface Props {
  /** Current asset id in the form ("" = none). */
  value: string;
  onChange: (assetId: string) => void;
  /** The saved logo, so an unchanged logo can show its presigned URL. */
  savedAssetId?: string;
  savedUrl?: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * Logo picker: uploads straight to storage with progress, and only puts the
 * new asset id into the form once the upload really finished. A failed upload
 * keeps the previous logo and says why.
 */
export function CompanyLogoField({ value, onChange, savedAssetId, savedUrl, disabled, onBusyChange }: Props) {
  const upload = useLogoUpload();
  const fileRef = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<{ assetId: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    if (local) URL.revokeObjectURL(local.url);
  }, [local]);

  useEffect(() => {
    onBusyChange?.(upload.isPending);
  }, [upload.isPending, onBusyChange]);

  const src =
    local && local.assetId === value ? local.url : value && value === savedAssetId ? savedUrl : undefined;

  const pick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    upload.mutate(file, {
      onSuccess: (assetId) => {
        setLocal({ assetId, url: URL.createObjectURL(file) });
        onChange(assetId);
      },
      onError: (e) => setError(getApiErrorMessage(e, "Logo upload failed")),
    });
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative flex size-28 items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned S3 / blob URL
          <img src={src} alt="Company logo" className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="px-2 text-center text-xs text-muted-foreground">{value ? "Logo uploaded" : "No logo"}</span>
        )}
        {upload.isPending ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 text-xs text-muted-foreground"
            role="status"
            aria-label="Uploading logo"
          >
            <Loader2 className="size-5 animate-spin" />
            {upload.progress !== null ? `${upload.progress}%` : "Uploading…"}
          </div>
        ) : null}
      </div>
      {!disabled ? (
        <div className="flex gap-1">
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_TYPES.join(",")}
            className="sr-only"
            aria-label="Upload logo"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus /> {value ? "Replace" : "Upload logo"}
          </Button>
          {value ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Remove logo"
              disabled={upload.isPending}
              onClick={() => {
                setError(null);
                onChange("");
              }}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="flex max-w-44 items-start gap-1 text-center text-[11px] text-destructive" role="alert">
          <AlertCircle className="mt-px size-3 flex-none" />
          <span>{error}</span>
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">PNG, JPEG or WebP · 5 MB max</p>
      )}
    </div>
  );
}
