"use client";

import { useId, useRef } from "react";

import { cn } from "@/lib/utils";

export interface WzUploadedFile {
  id: string;
  name: string;
  /** Thumbnail source; a non-image may pass "" and shows its name instead. */
  url: string;
}

export interface WzUploadFieldProps {
  /** "Check Image Front", "Before Job Image". */
  label: string;
  files: WzUploadedFile[];
  /** The picked files, already trimmed to what is left of `max`. */
  onAdd: (files: File[]) => void;
  onRemove?: (id: string) => void;
  /** Click on a thumbnail (Workiz opens its gallery). */
  onOpen?: (id: string) => void;
  /** Workiz allows 5 per field. */
  max?: number;
  accept?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A file custom field (ImageGallery, new_01_empty_scroll1 and
 * job_b_01_details_scroll2): the title 14px medium #404040; thumbnails 58px
 * (a #ddd 10px-cornered frame under a 57px picture with a #9ea6aa 4px edge),
 * 16px apart; the "+" tile 58×58 #f7f8f8 with a #9ea6aa edge and 4px corners;
 * under it "You can choose up to 5 files" at 11px #999. A red × appears on
 * a hovered thumbnail to remove it.
 */
export function WzUploadField({
  label,
  files,
  onAdd,
  onRemove,
  onOpen,
  max = 5,
  accept,
  disabled = false,
  className,
}: WzUploadFieldProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const room = Math.max(0, max - files.length);
  const addLabel = `Add files to ${label}`;

  return (
    <div role="group" aria-labelledby={`${id}-title`} data-slot="wz-upload" className={cn("min-w-0", className)}>
      <span id={`${id}-title`} className="text-[14px] leading-4 font-medium text-wz-strong">
        {label}
      </span>
      <div className="mt-2 mb-0.5 flex items-start overflow-y-auto">
        {files.map((f, i) => (
          <div
            key={f.id}
            className={cn(
              "group/thumb relative mt-2 mb-[5px] size-[58px] shrink-0 rounded-[10px] border border-[#dddddd]",
              i === files.length - 1 ? "mr-4" : "mr-2",
            )}
          >
            <button
              type="button"
              aria-label={`Open ${f.name}`}
              onClick={() => onOpen?.(f.id)}
              className="absolute -top-px -left-px size-[57px] cursor-pointer overflow-hidden rounded-[4px] border border-wz-outline bg-white p-0"
            >
              {f.url ? (
                // eslint-disable-next-line @next/next/no-img-element -- blob: and signed S3 URLs, not optimisable
                <img src={f.url} alt={f.name} className="size-full object-cover" />
              ) : (
                <span className="block truncate px-1 text-[10px] text-wz-caption">{f.name}</span>
              )}
            </button>
            {onRemove && !disabled ? (
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onRemove(f.id)}
                className="absolute -top-2 -right-2 hidden size-4 items-center justify-center rounded-full border-2 border-white bg-[#ff6f64] text-[10px] leading-none font-bold text-white group-hover/thumb:flex focus-visible:flex"
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
        {room > 0 && !disabled ? (
          <>
            <button
              type="button"
              aria-label={addLabel}
              onClick={() => inputRef.current?.click()}
              className="mt-2 box-content flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border border-wz-outline bg-wz-tile p-0"
            >
              {/* Workiz's plus.svg: 16px, ink. */}
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none">
                <path d="M8 1v14M1 8h14" stroke="var(--foreground)" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={accept}
              aria-label={addLabel}
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).slice(0, room);
                e.target.value = "";
                if (picked.length) onAdd(picked);
              }}
            />
          </>
        ) : null}
      </div>
      <span className="block text-[11px] leading-4 text-wz-caption">You can choose up to {max} files</span>
    </div>
  );
}
