"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown, Database, FileText, Loader2, Search, Sparkles } from "lucide-react";
import type { DocumentRenderContext } from "@bitcrm/types";
import { renderDocumentHtml } from "@bitcrm/document-renderer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import { renderTemplateHtml, renderTemplatePdf, type PreviewSource } from "../../api";
import { documentKeys, usePreviewSources, useServerPreviewHtml } from "../../hooks";
import { useEditorStore } from "../store";
import { useEditorUi } from "../ui-store";

/* ------------------------------------------------------------ live frame */

/**
 * The renderer's output in a sandboxed iframe (no scripts). Same-origin only so
 * the editor can read clicks: clicking a block jumps to it in the editor.
 */
function DocumentFrame({ html, title, onBlockClick, className }: { html: string; title: string; onBlockClick?: (id: string) => void; className?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const scroll = useRef(0);
  const clickRef = useRef(onBlockClick);
  useEffect(() => {
    clickRef.current = onBlockClick;
  });

  // Remember the scroll position across re-renders of the document.
  useEffect(() => {
    const win = ref.current?.contentWindow;
    return () => {
      scroll.current = win?.scrollY ?? scroll.current;
    };
  }, [html]);

  const onLoad = () => {
    const doc = ref.current?.contentDocument;
    const win = ref.current?.contentWindow;
    if (!doc || !win) return;
    win.scrollTo(0, scroll.current);
    if (!clickRef.current) return;
    const style = doc.createElement("style");
    style.textContent = "[data-block-id]{cursor:pointer}[data-block-id]:hover{outline:1px dashed #f59e0b;outline-offset:2px}";
    doc.head.appendChild(style);
    doc.addEventListener("click", (e) => {
      const target = (e.target as Element | null)?.closest?.("[data-block-id]");
      e.preventDefault();
      const id = target?.getAttribute("data-block-id");
      if (id) clickRef.current?.(id);
    });
  };

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={html}
      sandbox="allow-same-origin"
      onLoad={onLoad}
      className={cn("size-full border-0 bg-[#e5e7eb]", className)}
    />
  );
}

/** `interactive`: clicking a block selects it in the editor. */
export function LivePreview({ ctx, interactive = true }: { ctx: DocumentRenderContext; interactive?: boolean }) {
  const content = useEditorStore((s) => s.draft?.content);
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const source = useEditorUi((s) => s.previewSource);
  const debounced = useDebouncedValue(content, source ? 700 : 250);

  const sampleHtml = useMemo(
    () => (!source && debounced ? renderDocumentHtml(debounced, ctx, { mode: "screen", showBlockIds: true }) : null),
    [source, debounced, ctx],
  );
  const server = useServerPreviewHtml(
    source && debounced ? { kind, content: debounced, source: { kind: source.kind, id: source.id } } : null,
  );
  const html = source ? server.data : sampleHtml;

  const onBlockClick = (id: string) => {
    useEditorStore.getState().select({ type: "block", id });
    useEditorUi.getState().setMode("edit");
  };

  if (source && server.isError && !html) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <AlertCircle className="size-6 text-destructive" />
        <p className="text-sm">{getApiErrorMessage(server.error, "Couldn't render this document")}</p>
        <Button variant="outline" size="sm" onClick={() => useEditorUi.getState().setPreviewSource(null)}>
          Use sample data
        </Button>
      </div>
    );
  }
  if (!html) return <Skeleton className="m-6 h-[calc(100%-3rem)]" />;
  return (
    <div className="relative h-full">
      {source && server.isFetching ? (
        <span className="absolute top-2 right-3 z-10 flex items-center gap-1 rounded-chip bg-background/90 px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm">
          <Loader2 className="size-3 animate-spin" /> Updating
        </span>
      ) : null}
      <DocumentFrame html={html} title="Live preview" onBlockClick={source || !interactive ? undefined : onBlockClick} />
    </div>
  );
}

/* -------------------------------------------------------- source picker */

export function PreviewSourcePicker() {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const source = useEditorUi((s) => s.previewSource);
  const [open, setOpen] = useState(false);
  const [docKind, setDocKind] = useState<PreviewSource["kind"]>(kind === "estimate" ? "estimate" : "invoice");
  const [query, setQuery] = useState("");
  const q = useDebouncedValue(query, 300);
  const results = usePreviewSources(docKind, q, open);
  const kinds: PreviewSource["kind"][] = kind === "custom" ? ["invoice", "estimate"] : [kind];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-1.5" aria-label="Preview with">
          {source ? <Database /> : <Sparkles />}
          <span className="truncate">{source ? source.label : "Sample data"}</span>
          <ChevronDown className="opacity-60" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none"
        >
          <div className="px-1 pb-2 text-xs font-medium text-muted-foreground">Preview with</div>
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
            onClick={() => {
              useEditorUi.getState().setPreviewSource(null);
              setOpen(false);
            }}
          >
            <Sparkles className="size-4 text-muted-foreground" />
            <span className="flex-1">Sample data</span>
            {!source ? <Check className="size-4" /> : null}
          </button>
          <div className="my-2 h-px bg-border" />
          {kinds.length > 1 ? (
            <Tabs value={docKind} onValueChange={(v) => setDocKind(v as PreviewSource["kind"])} className="mb-2">
              <TabsList className="w-full">
                <TabsTrigger value="invoice">Invoices</TabsTrigger>
                <TabsTrigger value="estimate">Estimates</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`${docKind === "invoice" ? "Invoice" : "Estimate"} number or id`}
              aria-label="Search documents"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {results.isLoading ? (
              <div className="space-y-1 p-1">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : results.isError ? (
              <p className="p-3 text-center text-xs text-destructive">{getApiErrorMessage(results.error, "Couldn't search documents")}</p>
            ) : !results.data?.length ? (
              <p className="p-3 text-center text-xs text-muted-foreground">No {docKind}s found.</p>
            ) : (
              <ul className="py-1">
                {results.data.map((r) => (
                  <li key={`${r.kind}:${r.id}`}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                      onClick={() => {
                        useEditorUi.getState().setPreviewSource(r);
                        useEditorUi.getState().setMode("preview");
                        setOpen(false);
                      }}
                    >
                      <FileText className="size-4 flex-none text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{r.label}</span>
                        {r.sublabel ? <span className="block truncate text-[11px] text-muted-foreground">{r.sublabel}</span> : null}
                      </span>
                      {source?.id === r.id && source.kind === r.kind ? <Check className="size-4" /> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------ full preview */

function FullPreview({ ctx }: { ctx: DocumentRenderContext }) {
  // Snapshot what's on screen when the dialog opens.
  const [snapshot] = useState(() => useEditorStore.getState().draft);
  const source = useEditorUi((s) => s.previewSource);
  const [format, setFormat] = useState<"pdf" | "html">("pdf");
  const req = snapshot
    ? { kind: snapshot.kind, content: snapshot.content, source: source ? { kind: source.kind, id: source.id } : undefined }
    : null;

  const pdf = useQuery({
    queryKey: documentKeys.fullPreview("pdf", req),
    queryFn: () => renderTemplatePdf(req!),
    enabled: !!req && format === "pdf",
    staleTime: 60_000,
    gcTime: 0,
    retry: false,
  });
  const html = useQuery({
    queryKey: documentKeys.fullPreview("html", req),
    queryFn: () => (req!.source ? renderTemplateHtml(req!) : Promise.resolve(renderDocumentHtml(req!.content, ctx, { mode: "screen" }))),
    enabled: !!req && format === "html",
    staleTime: 60_000,
    gcTime: 0,
  });
  const q = format === "pdf" ? pdf : html;

  return (
    <>
      <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
        <div className="min-w-0">
          <DialogTitle className="truncate">Preview · {snapshot?.name}</DialogTitle>
          <DialogDescription>{source ? `With ${source.label}` : "With sample data"}</DialogDescription>
        </div>
        <Tabs value={format} onValueChange={(v) => setFormat(v as "pdf" | "html")}>
          <TabsList>
            <TabsTrigger value="pdf">PDF</TabsTrigger>
            <TabsTrigger value="html">Web</TabsTrigger>
          </TabsList>
        </Tabs>
      </DialogHeader>
      <div className="min-h-0 flex-1 overflow-hidden rounded-md border bg-muted">
        {q.isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            {format === "pdf" ? "Generating PDF…" : "Rendering…"}
          </div>
        ) : q.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm">{getApiErrorMessage(q.error, "Couldn't render the preview")}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => q.refetch()}>
                Try again
              </Button>
              {format === "pdf" ? (
                <Button variant="ghost" size="sm" onClick={() => setFormat("html")}>
                  Show web preview
                </Button>
              ) : null}
            </div>
          </div>
        ) : format === "pdf" && pdf.data ? (
          <iframe title="PDF preview" src={pdf.data} className="size-full border-0" />
        ) : html.data ? (
          <DocumentFrame html={html.data} title="Web preview" />
        ) : null}
      </div>
    </>
  );
}

export function PreviewDialog({ open, onOpenChange, ctx }: { open: boolean; onOpenChange: (o: boolean) => void; ctx: DocumentRenderContext }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[92svh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-5xl">
        {open ? <FullPreview ctx={ctx} /> : null}
      </DialogContent>
    </Dialog>
  );
}
