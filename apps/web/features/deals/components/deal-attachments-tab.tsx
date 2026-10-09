"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import {
  Camera,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  MoreVertical,
  Trash2,
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
import { useFilePreviewStore } from "@/features/files/preview-store";
import { fileTitle, workizDateTime } from "../job-shell";
import { UploadArt } from "./job-empty-art";
import { wzPill } from "@/components/workiz";
import { ATTACHMENT_ACCEPT, getAttachmentDownloadUrl } from "../attachments-api";
import {
  useAttachments,
  useAttachmentUrl,
  useDeleteAttachment,
  useUpdateAttachment,
  useUploadAttachment,
} from "../attachments-hooks";

export function DealAttachmentsTab({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const { data: items, isLoading } = useAttachments(dealId);
  const del = useDeleteAttachment(dealId);
  const preview = useFilePreviewStore((s) => s.preview);
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

  // Вікно поверх роботи, а не нова вкладка: читач не губить роботу з очей,
  // і посилання береться вже всередині вікна, у мить показу.
  const view = (att: DealAttachmentMeta) =>
    preview({
      name: att.fileName,
      contentType: att.contentType,
      load: async () => (await getAttachmentDownloadUrl(dealId, att.id)).downloadUrl,
    });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  return (
    <section aria-labelledby="job-attachments-heading" className="text-[#404040]">
      {/* Workiz: "Attachments" 18px/600 and a yellow "Upload" (job_b_tab_attachments). */}
      <div className="flex min-h-[53px] items-center justify-between gap-3 pt-2 pb-3">
        <h2 id="job-attachments-heading" className="text-[18px] leading-[22px] font-semibold">
          Attachments
        </h2>
        {canEdit ? <UploadButton dealId={dealId} /> : null}
      </div>

      {items && items.length > 0 ? (
        <div className="mt-5">
          {items.map((att) => (
            // 99px rows (audit_pixels T8): 21/10 padding, a #ddd rule under, #f8f8f8 on hover.
            <div key={att.id} className="flex items-center gap-[18px] border-b border-[#dddddd] px-2.5 py-[21px] hover:bg-[#f8f8f8]">
              {/* The thumbnail opens the file itself… */}
              <button
                type="button"
                onClick={() => view(att)}
                aria-label={`Open ${att.fileName}`}
                className="relative flex-none rounded-[8px] transition-opacity hover:opacity-80"
              >
                {att.contentType.startsWith("image/") ? (
                  <AttachmentThumb dealId={dealId} attachment={att} />
                ) : (
                  <span className="grid size-[58px] flex-none place-items-center rounded-[8px] border border-[#cad3d6] bg-[#f3f6f7] text-[#9ea6aa]">
                    <FileText className="size-6" />
                  </span>
                )}
              </button>

              {/* …the row opens the name/description editor. */}
              <button
                type="button"
                onClick={() => canEdit && setEditing(att)}
                className={cn("min-w-0 flex-1 text-left", !canEdit && "cursor-default")}
              >
                <span title={att.fileName} className="block truncate text-[16.8px] leading-5 font-medium">
                  {fileTitle(att.fileName)}
                </span>
                {att.description ? (
                  <span className="mt-1 block truncate text-[14px] leading-5 text-[#666666]">{att.description}</span>
                ) : null}
                <span className="mt-[15px] flex items-center gap-2 text-[14px] leading-5">
                  {att.category ? (
                    <span className="rounded-chip bg-[#f3f6f7] px-1.5 text-[11px] leading-[18px] uppercase tracking-wide text-[#566d76]">
                      {att.category}
                    </span>
                  ) : null}
                  {workizDateTime(att.uploadedAt)}
                </span>
              </button>

              <div className="relative flex-none">
                <button
                  type="button"
                  aria-label={`More actions for ${att.fileName}`}
                  aria-expanded={menuFor === att.id}
                  onClick={() => setMenuFor((m) => (m === att.id ? null : att.id))}
                  className="grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-[#f3f6f7]"
                >
                  <MoreVertical className="size-5" />
                </button>

                {menuFor === att.id ? (
                  <>
                    <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenuFor(null)} />
                    <div
                      role="menu"
                      className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-[2px] bg-white py-1 shadow-[0_3px_6px_2px_rgba(0,0,0,0.18),0_4px_15px_2px_rgba(0,0,0,0.15)]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setMenuFor(null); download(att); }}
                        className="flex w-full items-center gap-2.5 px-[15px] py-3 text-left text-[14px] text-[#566d76] hover:bg-[#f3f6f7]"
                      >
                        <Download className="size-4" strokeWidth={1.25} /> Download
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          role="menuitem"
                          disabled={del.isPending}
                          onClick={() => { setMenuFor(null); del.mutate(att.id); }}
                          className="flex w-full items-center gap-2.5 border-t border-[#cad3d6] px-[15px] py-3 text-left text-[14px] text-[#566d76] hover:bg-[#f3f6f7]"
                        >
                          <Trash2 className="size-4" strokeWidth={1.25} /> Delete
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
        // Workiz's empty state: the upload picture and "+ Upload files".
        <div className="flex flex-col items-center gap-4 border-b border-[#e6e6e6] pt-[70px] pb-[110px]">
          <UploadArt />
          {canEdit ? (
            <UploadButton dealId={dealId} variant="link" />
          ) : (
            <p className="text-[14px]">No attachments yet</p>
          )}
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
    </section>
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
      <span className="grid size-[58px] flex-none place-items-center rounded-[8px] border border-[#cad3d6] bg-[#f3f6f7] text-[#9ea6aa]">
        <ImageIcon className="size-6" />
      </span>
    );
  }

  return (
    // 58px, r8, a 1px #cad3d6 frame (Workiz's thumbnail).
    // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL; next/image can't optimize it
    <img
      src={data.downloadUrl}
      alt={attachment.fileName}
      onError={() => setBroken(true)}
      className="size-[58px] flex-none rounded-[8px] border border-[#cad3d6] object-cover"
    />
  );
}

/**
 * Workiz's yellow "Upload" pill with its camera — or, on the empty tab, the
 * blue "+ Upload files" link under the picture.
 */
function UploadButton({ dealId, variant = "pill" }: { dealId: string; variant?: "pill" | "link" }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAttachment(dealId);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate({ file: f });
          e.target.value = "";
        }}
      />
      {variant === "link" ? (
        <button
          type="button"
          disabled={upload.isPending}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-[14px] leading-4 font-semibold text-[#6aa8ee] hover:underline disabled:opacity-50"
        >
          {upload.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}+ Upload files
        </button>
      ) : (
        <button type="button" className={wzPill("yellow", "small")} disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Camera className="size-3.5!" strokeWidth={2.25} />}
          Upload
        </button>
      )}
    </>
  );
}
