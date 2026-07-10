"use client";

import { useRef, useState } from "react";
import { FileText, Loader2, Upload, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useImportProducts } from "../hooks";
import type { ImportResult } from "../api";
import { IMPORT_REQUIRED_COLUMNS, IMPORT_OPTIONAL_COLUMNS } from "../lib";

export function ImportProductsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importMut = useImportProducts();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setPreviewing(false);
    setImporting(false);
  };

  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };

  const pick = async (f: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setPreviewing(true);
    try {
      const result = await importMut.mutateAsync({ file: f, dryRun: true });
      setPreview(result);
    } catch {
      // hook surfaces the toast; leave preview null
    } finally {
      setPreviewing(false);
    }
  };

  const runImport = async () => {
    if (!file) return;
    setImporting(true);
    try {
      await importMut.mutateAsync({ file, dryRun: false });
      close(false);
    } catch {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import products</DialogTitle>
          <DialogDescription>
            Upload a CSV. Rows are matched by SKU — existing products update, new
            ones are created.
          </DialogDescription>
        </DialogHeader>

        {!file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-sm text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
          >
            <Upload className="size-6" />
            <span>
              <span className="font-medium text-foreground">Click to browse</span> — CSV, ≤5MB
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm">
            <FileText className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <Button variant="ghost" size="icon" className="size-7" onClick={reset}>
              <X className="size-4" />
            </Button>
          </div>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        {previewing ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Validating…
          </div>
        ) : preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Stat n={preview.created} label="Create" tone="good" />
              <Stat n={preview.updated} label="Update" tone="accent" />
              <Stat n={preview.errors.length} label="Errors" tone={preview.errors.length ? "bad" : "muted"} />
            </div>
            {preview.errors.length > 0 ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-2">
                {preview.errors.map((e, i) => (
                  <div key={i} className="font-mono text-xs text-destructive">
                    Row {e.row} — {e.message}
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Valid rows import even if some fail. Errors are skipped.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Columns:{" "}
            <code className="font-mono">{IMPORT_REQUIRED_COLUMNS.join(", ")}</code>
            {" "}+ optional{" "}
            <code className="font-mono">{IMPORT_OPTIONAL_COLUMNS.join(", ")}</code>.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant="brand"
            className="gap-1.5"
            disabled={!file || previewing || importing || (preview?.created === 0 && preview?.updated === 0)}
            onClick={runImport}
          >
            {importing ? <Loader2 className="size-4 animate-spin" /> : null}
            {preview ? `Import ${preview.created + preview.updated}` : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: "good" | "accent" | "bad" | "muted";
}) {
  const color =
    tone === "good"
      ? "text-green-600 dark:text-green-500"
      : tone === "accent"
        ? "text-brand"
        : tone === "bad"
          ? "text-destructive"
          : "text-muted-foreground";
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-center">
      <div className={cn("text-xl font-semibold tabular-nums", color)}>{n}</div>
      <div className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </div>
    </div>
  );
}
