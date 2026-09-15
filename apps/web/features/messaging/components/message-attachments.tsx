"use client";

import { FileText, Paperclip } from "lucide-react";
import type { MessageAttachment } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { formatBytes, isImageAttachment } from "../lib";

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
}: {
  attachments: MessageAttachment[];
  align?: "start" | "end";
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", align === "end" && "justify-end")}>
      {attachments.map((a) => {
        const url = attachmentUrl(a);
        if (isImageAttachment(a) && url) {
          return (
            <a
              key={a.id}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg border bg-background"
              title={a.fileName}
            >
              {/* External / presigned URLs — next/image cannot optimise them. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={a.fileName}
                loading="lazy"
                className="max-h-64 max-w-[16rem] object-cover"
              />
            </a>
          );
        }
        const chip = (
          <>
            {isImageAttachment(a) ? (
              <Paperclip className="size-3.5 shrink-0" />
            ) : (
              <FileText className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{a.fileName}</span>
            {a.size ? (
              <span className="shrink-0 text-[11px] opacity-70">{formatBytes(a.size)}</span>
            ) : null}
          </>
        );
        return url ? (
          <a
            key={a.id}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-64 items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-muted"
          >
            {chip}
          </a>
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
            className="inline-flex max-w-64 items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground"
          >
            {chip}
          </span>
        );
      })}
    </div>
  );
}
