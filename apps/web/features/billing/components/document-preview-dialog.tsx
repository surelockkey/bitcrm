"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";

/**
 * Renders a document's server-rendered HTML in a sandboxed iframe (no scripts,
 * no same-origin) — the same markup the PDF is printed from.
 */
export function DocumentPreviewDialog({
  open,
  onOpenChange,
  title,
  queryKey,
  fetchHtml,
  onDownload,
  downloadPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  queryKey: readonly unknown[];
  fetchHtml: () => Promise<{ html: string }>;
  onDownload?: () => void;
  downloadPending?: boolean;
}) {
  const q = useQuery({
    queryKey: [...queryKey, "preview-html"],
    queryFn: fetchHtml,
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90svh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-4xl">
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
          <div className="min-w-0">
            <DialogTitle className="truncate">{title}</DialogTitle>
            <DialogDescription className="sr-only">Document preview</DialogDescription>
          </div>
          {onDownload ? (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onDownload} disabled={downloadPending}>
              {downloadPending ? <Loader2 className="animate-spin" /> : <Download />} PDF
            </Button>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-white">
          {q.isLoading ? (
            <div className="space-y-3 p-6">
              <Skeleton className="h-8 w-1/3" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-64 w-full" />
            </div>
          ) : q.isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
              <AlertCircle className="size-5 text-destructive" />
              {getApiErrorMessage(q.error, "Couldn't render the preview")}
              <Button variant="outline" size="sm" onClick={() => q.refetch()}>Try again</Button>
            </div>
          ) : (
            <iframe
              title={`${title} preview`}
              srcDoc={q.data?.html ?? ""}
              sandbox=""
              className="size-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
