"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FileText, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useFilePreviewStore } from "@/features/files/preview-store";
import { formatBytes } from "@/features/messaging/lib";
import { ATTACHMENT_ACCEPT, getFileDownloadUrl, isJobFile, type ContactFileRow } from "@/features/deals/attachments-api";
import { useAttachmentsByContact, useDeleteContactAttachment, useFileUrl, useUploadContactAttachment } from "@/features/deals/attachments-hooks";
import { monthLabel } from "../notes-lib";

type FilesTab = "all" | "media" | "documents";

/** Workiz's split: Media is what a camera makes, Documents is the rest. */
export const isMedia = (row: ContactFileRow): boolean =>
  row.contentType.startsWith("image/") || row.contentType.startsWith("video/");

/**
 * Workiz's Files rail on the client card: the client's own files and its
 * jobs' files in one feed, by month — photos as a grid, documents as rows.
 * A job's file names its job; only the client's own files can be removed here.
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
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[400px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>Files</SheetTitle>
          <SheetDescription className="sr-only">The client&apos;s files and its jobs&apos; files, newest first.</SheetDescription>
        </SheetHeader>
        {open ? <FilesBody contactId={contactId} canEdit={canEdit} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function FilesBody({ contactId, canEdit }: { contactId: string; canEdit: boolean }) {
  const query = useAttachmentsByContact(contactId);
  const del = useDeleteContactAttachment(contactId);
  const preview = useFilePreviewStore((s) => s.preview);
  const [tab, setTab] = useState<FilesTab>("all");

  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  const groups = useMemo(() => {
    const shown = rows.filter((r) => (tab === "all" ? true : tab === "media" ? isMedia(r) : !isMedia(r)));
    const out: { label: string; media: ContactFileRow[]; documents: ContactFileRow[] }[] = [];
    for (const r of [...shown].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))) {
      const label = monthLabel(r.uploadedAt);
      let g = out.at(-1);
      if (!g || g.label !== label) {
        g = { label, media: [], documents: [] };
        out.push(g);
      }
      (isMedia(r) ? g.media : g.documents).push(r);
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

  const actions = (row: ContactFileRow) => (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        aria-label={`Download ${row.fileName}`}
        onClick={() => download(row)}
        className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Download className="size-3.5" />
      </button>
      {canEdit && !isJobFile(row) ? (
        <button
          type="button"
          aria-label={`Delete ${row.fileName}`}
          disabled={del.isPending}
          onClick={() => del.mutate(row.id)}
          className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </div>
  );

  return (
    <>
      <div className="space-y-3 border-b px-4 py-3">
        {canEdit ? <UploadButton contactId={contactId} /> : null}
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilesTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {query.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No files yet.</p>
        ) : (
          groups.map((g) => (
            <section key={g.label} className="space-y-2">
              <h3 className="text-sm font-medium text-muted-foreground">{g.label}</h3>
              {g.media.length ? (
                <div data-testid={`media-grid-${g.label}`} className="grid grid-cols-3 gap-2">
                  {g.media.map((row) => (
                    <div key={row.id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => view(row)}
                        aria-label={`Open ${row.fileName}`}
                        className="block w-full overflow-hidden rounded-md transition-opacity hover:opacity-80"
                      >
                        <FileThumb row={row} />
                      </button>
                      <div className="flex items-center justify-between gap-1">
                        <JobCode row={row} />
                        {actions(row)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              {g.documents.map((row) => (
                <div key={row.id} data-testid="file-row" className="flex items-center gap-3 rounded-md border px-3 py-2">
                  <span className="grid size-9 flex-none place-items-center rounded-md bg-muted text-muted-foreground">
                    <FileText className="size-4" />
                  </span>
                  <button type="button" onClick={() => view(row)} aria-label={`Open ${row.fileName}`} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-medium">{row.fileName}</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {formatBytes(row.size)}
                    </span>
                  </button>
                  <JobCode row={row} />
                  {actions(row)}
                </div>
              ))}
            </section>
          ))
        )}

        {query.hasNextPage ? (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Load more"}
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** The job a file came from, linked — the client's own files have none. */
function JobCode({ row }: { row: ContactFileRow }) {
  if (!isJobFile(row) || !row.dealNumber) return <span />;
  return (
    <Link href={`/deals/${row.dealId}`} className="truncate font-mono text-xs font-medium text-brand hover:underline">
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
      <span className="grid aspect-square w-full place-items-center bg-muted text-muted-foreground">
        <ImageIcon className="size-6" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL; next/image can't optimize it
    <img src={data.downloadUrl} alt={row.fileName} onError={() => setBroken(true)} className="aspect-square w-full object-cover" />
  );
}

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
        className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline disabled:opacity-50"
      >
        {upload.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload file
      </button>
    </>
  );
}
