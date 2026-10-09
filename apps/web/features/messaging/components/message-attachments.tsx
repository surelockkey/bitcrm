"use client";

import { FileText, Paperclip } from "lucide-react";
import type { MessageAttachment } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatBytes, isImageAttachment } from "../lib";
import { useFilePreviewStore } from "@/features/files/preview-store";

/**
 * The address a file can be opened from. Imported Workiz media keeps its
 * source URL until the media stage copies it; live MMS lands in S3 under
 * `s3Key`, which needs the presigned-GET route to be served — until then
 * those render as a named chip rather than a broken link.
 */
export function attachmentUrl(a: MessageAttachment): string | undefined {
  return a.sourceUrl || undefined;
}

export function MessageAttachments({
  attachments,
  align = "start",
  thumbnails = false,
}: {
  attachments: MessageAttachment[];
  align?: "start" | "end";
  /** Inside a bubble, Workiz shows images as small square thumbnails that open the full picture. */
  thumbnails?: boolean;
}) {
  const preview = useFilePreviewStore((st) => st.preview);
  // Посилання на медіа вже підписане — вікно бере його як є.
  const open = (a: MessageAttachment, url: string) =>
    preview({ name: a.fileName, contentType: a.contentType, load: async () => url });

  if (!attachments.length) return null;
  return (
    <div className={cn("flex flex-wrap", thumbnails ? "gap-x-2 gap-y-2" : "gap-2", align === "end" && "justify-end")}>
      {attachments.map((a) => {
        const url = attachmentUrl(a);
        if (isImageAttachment(a) && url) {
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => open(a, url)}
              className={cn(
                "relative block shrink-0 overflow-hidden bg-background",
                // Workiz's `ImageGallery__image_row_container`: 100×85 inside a 1px #ddd frame, r10.
                thumbnails ? "h-[87px] w-[102px] rounded-[10px] border border-wz-frame" : "rounded-[8px] border border-wz-frame",
              )}
              title={a.fileName}
            >
              {/* External / presigned URLs — next/image cannot optimise them. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={a.fileName}
                loading="lazy"
                className={
                  thumbnails ? "absolute inset-0 size-full rounded-[8px] object-cover" : "max-h-64 max-w-[16rem] object-cover"
                }
              />
            </button>
          );
        }
        const chip = (
          <>
            {isImageAttachment(a) ? (
              <Paperclip className="size-3.5 shrink-0" strokeWidth={1.5} />
            ) : (
              <FileText className="size-3.5 shrink-0" strokeWidth={1.5} />
            )}
            <span className="truncate">{a.fileName}</span>
            {a.size ? <span className="shrink-0 text-[11px] opacity-70">{formatBytes(a.size)}</span> : null}
          </>
        );
        return url ? (
          <button
            key={a.id}
            type="button"
            onClick={() => open(a, url)}
            className="inline-flex max-w-64 items-center gap-1.5 rounded-[4px] border border-wz-frame bg-background px-2 py-1 text-[12px] leading-4 text-foreground hover:bg-wz-secondary-hover"
          >
            {chip}
          </button>
        ) : (
          <span
            key={a.id}
            title={
              a.status === "deferred"
                ? "Media is still being imported"
                : a.status === "failed"
                  ? "Media could not be stored"
                  : "Stored — a download link arrives with the media route"
            }
            className="inline-flex max-w-64 items-center gap-1.5 rounded-[4px] border border-dashed border-wz-frame bg-background px-2 py-1 text-[12px] leading-4 text-wz-text"
          >
            {chip}
          </span>
        );
      })}
    </div>
  );
}
