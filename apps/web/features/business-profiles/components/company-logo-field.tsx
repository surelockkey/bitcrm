"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, ImagePlus, Loader2 } from "lucide-react";
import { WzButton } from "@/components/workiz/button";
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
 * The logo beside the company's fields, as the Account page draws the
 * account's (pg_settings_general_wz_account): the picture 150px wide under
 * Workiz's menu shadow, a yellow "x" on its top-right corner to take it off,
 * "Upload Logo" under it. Uploads straight to storage with progress, and only
 * puts the new asset id into the form once the upload really finished. A
 * failed upload keeps the previous logo and says why.
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
    <div className="flex w-[300px] flex-col items-start gap-4 pt-2">
      <div className="relative">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned S3 / blob URL
          <img
            src={src}
            alt="Company logo"
            className="block max-h-[120px] w-[150px] object-contain shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)]"
          />
        ) : (
          <div className="flex h-[47px] w-[150px] items-center justify-center bg-muted px-2 text-center text-xs text-wz-outline-label shadow-[0_3px_6px_rgba(0,0,0,0.18),0_4px_15px_rgba(0,0,0,0.15)]">
            {value ? "Logo uploaded" : "No logo"}
          </div>
        )}
        {value && !disabled ? (
          // Workiz's `imageClear`: a 21px "x" on #ffd400 over the corner.
          <button
            type="button"
            aria-label="Remove logo"
            disabled={upload.isPending}
            onClick={() => {
              setError(null);
              onChange("");
            }}
            className="absolute top-0 right-0 cursor-pointer bg-wz-focus px-[7px] pt-0.5 pb-[5px] text-[21px] leading-[21px] text-wz-strong outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:cursor-not-allowed"
          >
            x
          </button>
        ) : null}
        {upload.isPending ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/80 text-xs text-wz-outline-label"
            role="status"
            aria-label="Uploading logo"
          >
            <Loader2 className="size-5 animate-spin" />
            {upload.progress !== null ? `${upload.progress}%` : "Uploading…"}
          </div>
        ) : null}
      </div>
      {!disabled ? (
        <>
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
          <WzButton
            variant="secondary"
            size="regular"
            icon={<ImagePlus />}
            disabled={upload.isPending}
            onClick={() => fileRef.current?.click()}
          >
            {value ? "Replace Logo" : "Upload Logo"}
          </WzButton>
        </>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1 text-xs leading-[18px] text-wz-error" role="alert">
          <AlertCircle className="mt-0.5 size-3 flex-none" />
          <span>{error}</span>
        </p>
      ) : (
        <p className="text-xs leading-[18px] text-wz-outline-label">PNG, JPEG or WebP · 5 MB max</p>
      )}
    </div>
  );
}
