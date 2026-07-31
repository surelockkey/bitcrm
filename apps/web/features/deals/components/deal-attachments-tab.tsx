"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import type { DealAttachmentMeta } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDate } from "@/features/users/lib";
import { getAttachmentDownloadUrl } from "../attachments-api";
import {
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from "../attachments-hooks";

const ACCEPT = "image/png,image/jpeg,image/webp,image/heic,application/pdf";

export function DealAttachmentsTab({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { data: items, isLoading } = useAttachments(dealId);
  const del = useDeleteAttachment(dealId);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const view = (att: DealAttachmentMeta) => {
    // Open the tab synchronously inside the click gesture — opening it after the
    // await would be a non-user-initiated popup that browsers block (blank tab).
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setViewingId(att.id);
    void (async () => {
      try {
        const { downloadUrl } = await getAttachmentDownloadUrl(dealId, att.id);
        if (tab) tab.location.replace(downloadUrl);
        else window.open(downloadUrl, "_blank", "noopener,noreferrer");
      } catch (e) {
        tab?.close();
        toast.error(getApiErrorMessage(e));
      } finally {
        setViewingId(null);
      }
    })();
  };

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {items?.length
            ? `${items.length} file${items.length === 1 ? "" : "s"}`
            : "No attachments yet"}
        </p>
        {canEdit ? <UploadButton dealId={dealId} /> : null}
      </div>

      {items && items.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {items.map((att) => (
            <div key={att.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="grid size-9 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
                {att.contentType.startsWith("image/") ? (
                  <ImageIcon className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{att.fileName}</div>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {att.category ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">
                      {att.category}
                    </span>
                  ) : null}
                  <span>{formatDate(att.uploadedAt)}</span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={viewingId === att.id}
                onClick={() => view(att)}
              >
                {viewingId === att.id ? <Loader2 className="size-3.5 animate-spin" /> : "View"}
              </Button>
              {canEdit ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  disabled={del.isPending}
                  onClick={() => del.mutate(att.id)}
                  aria-label={`Delete ${att.fileName}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Paperclip className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Attach photos (before/after, parts, check) and documents.
          </p>
          {canEdit ? <UploadButton dealId={dealId} /> : null}
        </div>
      )}
    </div>
  );
}

function UploadButton({ dealId }: { dealId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAttachment(dealId);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate({ file: f });
          e.target.value = "";
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        Upload
      </Button>
    </>
  );
}
