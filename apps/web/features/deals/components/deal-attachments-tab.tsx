"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  FileText,
  ImageIcon,
  Loader2,
  MoreVertical,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import type { DealAttachmentMeta } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDate } from "@/features/users/lib";
import { getAttachmentDownloadUrl } from "../attachments-api";
import {
  useAttachments,
  useAttachmentUrl,
  useDeleteAttachment,
  useUpdateAttachment,
  useUploadAttachment,
} from "../attachments-hooks";

const ACCEPT = "image/png,image/jpeg,image/webp,image/heic,application/pdf";

export function DealAttachmentsTab({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { data: items, isLoading } = useAttachments(dealId);
  const del = useDeleteAttachment(dealId);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<DealAttachmentMeta | null>(null);

  /** Fetch via the presigned URL and hand the bytes to the browser as a save-as. */
  const download = (att: DealAttachmentMeta) => {
    void (async () => {
      try {
        const { downloadUrl } = await getAttachmentDownloadUrl(dealId, att.id);
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error("Download failed");
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = att.fileName;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast.error(getApiErrorMessage(e));
      }
    })();
  };

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
            <div key={att.id} className="flex items-center gap-4 px-4 py-3.5 hover:bg-muted/30">
              {/* The thumbnail opens the file itself… */}
              <button
                type="button"
                onClick={() => view(att)}
                disabled={viewingId === att.id}
                aria-label={`Open ${att.fileName}`}
                className="relative flex-none rounded-md transition-opacity hover:opacity-80"
              >
                {att.contentType.startsWith("image/") ? (
                  <AttachmentThumb dealId={dealId} attachment={att} />
                ) : (
                  <span className="grid size-14 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-6" />
                  </span>
                )}
                {viewingId === att.id ? (
                  <span className="absolute inset-0 grid place-items-center rounded-md bg-background/60">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                ) : null}
              </button>

              {/* …the row opens the name/description editor. */}
              <button
                type="button"
                onClick={() => canEdit && setEditing(att)}
                className={cn("min-w-0 flex-1 text-left", !canEdit && "cursor-default")}
              >
                <span className="block truncate text-[15px] font-semibold">{att.fileName}</span>
                {att.description ? (
                  <span className="block truncate text-sm text-muted-foreground">{att.description}</span>
                ) : null}
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  {att.category ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">
                      {att.category}
                    </span>
                  ) : null}
                  {formatDate(att.uploadedAt)}
                </span>
              </button>

              <div className="relative flex-none">
                <button
                  type="button"
                  aria-label={`More actions for ${att.fileName}`}
                  aria-expanded={menuFor === att.id}
                  onClick={() => setMenuFor((m) => (m === att.id ? null : att.id))}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                >
                  <MoreVertical className="size-4" />
                </button>

                {menuFor === att.id ? (
                  <>
                    <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuFor(null)} />
                    <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border bg-popover py-1 shadow-md">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenuFor(null); download(att); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60"
                      >
                        <Download className="size-4 text-muted-foreground" /> Download
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={del.isPending}
                          onClick={() => { setMenuFor(null); del.mutate(att.id); }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-muted/60"
                        >
                          <Trash2 className="size-4" /> Delete
                        </button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
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

      {editing ? (
        <AttachmentEditDialog
          key={editing.id}
          dealId={dealId}
          attachment={editing}
          onOpenChange={(v) => !v && setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** Rename the file / edit its description, Workiz-style (opened by a row click). */
function AttachmentEditDialog({
  dealId,
  attachment,
  onOpenChange,
}: {
  dealId: string;
  attachment: DealAttachmentMeta;
  onOpenChange: (v: boolean) => void;
}) {
  const update = useUpdateAttachment(dealId);
  const [name, setName] = useState(attachment.fileName);
  const [description, setDescription] = useState(attachment.description ?? "");

  const save = () => {
    update.mutate(
      { attachmentId: attachment.id, body: { fileName: name.trim(), description } },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-md">
        <DialogHeader>
          <DialogTitle>Edit attachment</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="attachment-name">Name</Label>
            <Input
              id="attachment-name"
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attachment-description">Description</Label>
            <Textarea
              id="attachment-description"
              rows={3}
              placeholder="What's on this photo / in this file?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            type="button"
            variant="brand"
            className="gap-1.5"
            disabled={update.isPending || name.trim().length === 0}
            onClick={save}
          >
            {update.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Photo thumbnail for an image attachment. The bytes live in private S3, so the
 * src is a short-lived presigned URL. Falls back to the stub icon while the URL
 * loads or if the bytes fail (expired URL, HEIC the browser can't decode, or a
 * meta row whose upload never finished).
 */
function AttachmentThumb({ dealId, attachment }: { dealId: string; attachment: DealAttachmentMeta }) {
  const { data } = useAttachmentUrl(dealId, attachment.id);
  const [broken, setBroken] = useState(false);

  if (!data?.downloadUrl || broken) {
    return (
      <span className="grid size-14 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
        <ImageIcon className="size-6" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL; next/image can't optimize it
    <img
      src={data.downloadUrl}
      alt={attachment.fileName}
      onError={() => setBroken(true)}
      className="size-14 flex-none rounded-md object-cover"
    />
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
