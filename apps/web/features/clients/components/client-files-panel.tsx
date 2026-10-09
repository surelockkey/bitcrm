"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { WzRailPanel } from "@/components/workiz/rail";
import { WzSegmented } from "@/components/workiz/record-parts";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useFilePreviewStore } from "@/features/files/preview-store";
import { formatBytes } from "@/features/messaging/lib";
import { ATTACHMENT_ACCEPT, getFileDownloadUrl, isJobFile, type ContactFileRow } from "@/features/deals/attachments-api";
import { useAttachmentsByContact, useDeleteContactAttachment, useFileUrl, useUploadContactAttachment } from "@/features/deals/attachments-hooks";
import { monthLabel } from "../notes-lib";
import { EmptyFilesArt } from "./client-rail-art";

type FilesTab = "all" | "media" | "documents";

const TABS = [
  { value: "all", label: "All" },
  { value: "media", label: "Media" },
  { value: "documents", label: "Documents" },
] as const;

/** Workiz's split: Media is what a camera makes, Documents is the rest. */
export const isMedia = (row: ContactFileRow): boolean =>
  row.contentType.startsWith("image/") || row.contentType.startsWith("video/");

/** The badge on a document's tile: the file's extension, "PDF", "DOCX". */
const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toUpperCase().slice(0, 4) : "FILE");

/** A tile's own small buttons, on a white chip over the picture. */
const TILE_ICON = "grid size-6 place-items-center rounded-[4px] bg-white/90 text-foreground hover:bg-white";

/**
 * Workiz's Files panel on the client page (pg_contact_wz_269669_12/_17): "Upload
 * file" (#6aa8ee), the All | Media | Documents switch (Media first, as Workiz
 * opens it), then the files by month as 95px tiles three a row — a photo's
 * thumbnail, a document's grey tile with its type. The client's own files and
 * its jobs' files are one feed; ours puts the job's number, Download and (on
 * the client's own files) Delete on the tile.
 */
export function ClientFilesPanel({
  contactId,
  canEdit,
  open,
  onOpenChange,
}: {
  contactId: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <WzRailPanel variant="plain" aria-label="Files" title="Files" onClose={() => onOpenChange(false)} className="max-md:w-full">
      <FilesBody contactId={contactId} canEdit={canEdit} />
    </WzRailPanel>
  );
}

function FilesBody({ contactId, canEdit }: { contactId: string; canEdit: boolean }) {
  const query = useAttachmentsByContact(contactId);
  const del = useDeleteContactAttachment(contactId);
  const preview = useFilePreviewStore((s) => s.preview);
  const [tab, setTab] = useState<FilesTab>("media");

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const groups = useMemo(() => {
    const shown = rows.filter((r) => (tab === "all" ? true : tab === "media" ? isMedia(r) : !isMedia(r)));
    const out: { label: string; files: ContactFileRow[] }[] = [];
    for (const r of [...shown].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))) {
      const label = monthLabel(r.uploadedAt);
      let g = out.at(-1);
      if (!g || g.label !== label) {
        g = { label, files: [] };
        out.push(g);
      }
      g.files.push(r);
    }
    return out;
  }, [rows, tab]);

  /** Fetch via the presigned URL and hand the bytes to the browser as a save-as. */
  const download = (row: ContactFileRow) => {
    void (async () => {
      try {
        const { downloadUrl } = await getFileDownloadUrl(row);
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error("Download failed");
        const url = URL.createObjectURL(await res.blob());
        const a = document.createElement("a");
        a.href = url;
        a.download = row.fileName;
        a.click();
        URL.revokeObjectURL(url);
      } catch (e) {
        toast.error(getApiErrorMessage(e));
      }
    })();
  };

  // The shared preview window; the link is taken at the moment of opening.
  const view = (row: ContactFileRow) =>
    preview({
      name: row.fileName,
      contentType: row.contentType,
      load: async () => (await getFileDownloadUrl(row)).downloadUrl,
    });

  return (
    <div className="px-4 pb-6">
      {canEdit ? (
        <div className="mt-[13px]">
          <UploadButton contactId={contactId} />
        </div>
      ) : null}
      <WzSegmented aria-label="Show files" options={TABS} value={tab} onChange={setTab} className={canEdit ? "mt-6" : "mt-4"} />

      <div className="mt-6">
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : groups.length === 0 ? (
          <div className="mt-[160px] flex flex-col items-center text-center">
            <EmptyFilesArt />
            <p className="mt-6 text-sm leading-[21px] tracking-[0.4px] text-foreground">This client doesn’t have any files</p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="mb-6">
              <h3 className="text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">{g.label}</h3>
              <div data-testid={`files-grid-${g.label}`} className="mt-4 grid grid-cols-[repeat(3,95px)] gap-x-[9px] gap-y-[18px]">
                {g.files.map((row) => (
                  <div key={row.id} data-testid={isMedia(row) ? "media-tile" : "file-row"} className="group/tile relative size-[95px]" title={row.fileName}>
                    <button
                      type="button"
                      onClick={() => view(row)}
                      aria-label={`Open ${row.fileName}`}
                      className="block size-full overflow-hidden rounded-[4px] border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {isMedia(row) ? (
                        <FileThumb row={row} />
                      ) : (
                        <span className="grid size-full place-items-center bg-[#e4e7e8]">
                          {/* pg_contact_wz_269669_17_files_documents: a sheet with a green type badge. */}
                          <span className="relative h-[54px] w-[44px] rounded-[2px] border border-wz-outline bg-white">
                            <span className="absolute top-2 -left-2 rounded-[2px] bg-[#22c55e] px-1 text-[10px] leading-[14px] font-medium tracking-[0.5px] text-white">
                              {extensionOf(row.fileName)}
                            </span>
                          </span>
                        </span>
                      )}
                      <span className="sr-only">
                        {row.fileName} {isMedia(row) ? "" : formatBytes(row.size)}
                      </span>
                    </button>
                    {/* Ours: where the file came from, and its actions, over the tile's foot. */}
                    <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-between gap-1 opacity-0 transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
                      <JobCode row={row} />
                      <span className="pointer-events-auto flex items-center gap-0.5">
                        <button type="button" aria-label={`Download ${row.fileName}`} onClick={() => download(row)} className={TILE_ICON}>
                          <Download className="size-3.5" strokeWidth={1.5} />
                        </button>
                        {canEdit && !isJobFile(row) ? (
                          <button
                            type="button"
                            aria-label={`Delete ${row.fileName}`}
                            disabled={del.isPending}
                            onClick={() => del.mutate(row.id)}
                            className={`${TILE_ICON} hover:text-wz-danger`}
                          >
                            <Trash2 className="size-3.5" strokeWidth={1.5} />
                          </button>
                        ) : null}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}

        {query.hasNextPage ? (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The job a file came from, linked — the client's own files have none. */
function JobCode({ row }: { row: ContactFileRow }) {
  if (!isJobFile(row) || !row.dealNumber) return <span />;
  return (
    <Link href={`/deals/${row.dealId}`} className="pointer-events-auto truncate rounded-[4px] bg-white/90 px-1 text-[11px] leading-4 font-medium text-brand hover:underline">
      {row.dealNumber}
    </Link>
  );
}

/**
 * A photo's thumbnail: the bytes sit in private S3, so the src is a short-lived
 * presigned URL; the stub icon stands in while it loads or if it fails.
 */
function FileThumb({ row }: { row: ContactFileRow }) {
  const { data } = useFileUrl(row);
  const [broken, setBroken] = useState(false);

  if (!data?.downloadUrl || broken) {
    return (
      <span className="grid size-full place-items-center bg-muted text-wz-outline-label">
        <ImageIcon className="size-6" strokeWidth={1.25} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL; next/image can't optimize it
    <img src={data.downloadUrl} alt={row.fileName} onError={() => setBroken(true)} className="size-full object-cover" />
  );
}

/** Workiz's "Upload file": an upload glyph and 13px/19px 600 #6aa8ee words. */
function UploadButton({ contactId }: { contactId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadContactAttachment(contactId);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        data-testid="client-file-input"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={upload.isPending}
        onClick={() => inputRef.current?.click()}
        className="flex h-[19px] w-fit items-center gap-1.5 text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:underline disabled:opacity-50"
      >
        {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" strokeWidth={1.75} />} Upload file
      </button>
    </>
  );
}
