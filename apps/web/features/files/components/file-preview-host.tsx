"use client";

import { useEffect, useState } from "react";
import { Download, FileQuestion, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getApiErrorMessage } from "@/lib/api/errors";
import { isImage, isPdf, useFilePreviewStore, type PreviewFile } from "../preview-store";

/**
 * Вікно перегляду вкладення — одне на весь застосунок.
 *
 * Досі файл відкривався новою вкладкою: читач губив роботу з очей і
 * повертався через історію браузера, а спливне вікно ще й блокувалось, якщо
 * посилання встигало прийти пізніше за клік. Тут файл лягає поверх сторінки,
 * а сторінка лишається там, де була.
 */
export function FilePreviewHost() {
  const file = useFilePreviewStore((s) => s.file);
  const close = useFilePreviewStore((s) => s.close);

  if (!file) return null;

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="flex h-[85vh] flex-col gap-0 p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-3.5 pr-12">
          <DialogTitle className="truncate text-base">{file.name}</DialogTitle>
        </DialogHeader>
        {/* Ключем — сам файл: наступне відкриття починає з чистого стану, а
            підписане посилання береться заново, бо старе вже прострочене. */}
        <PreviewBody key={file.name + String(file.contentType)} file={file} />
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({ file }: { file: PreviewFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    file
      .load()
      .then((next) => alive && setUrl(next))
      .catch((e) => alive && setError(getApiErrorMessage(e)));
    return () => {
      alive = false;
    };
  }, [file]);

  if (error) {
    return (
      <Centered>
        <FileQuestion className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">{error}</p>
      </Centered>
    );
  }
  if (!url) {
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Centered>
    );
  }

  if (isPdf(file)) {
    return <iframe src={url} title={file.name} className="min-h-0 w-full flex-1 border-0" />;
  }
  if (isImage(file)) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
        {/* Звичайний <img>: джерело — підписане посилання на чужий домен, яке
            оптимізатор Next однаково не візьме. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.name} className="max-h-full max-w-full object-contain" />
      </div>
    );
  }

  // Формат, якого браузер не показує (docx, xlsx, zip): вікно не вдає, що
  // вміє його відкрити, а пропонує забрати файл.
  return (
    <Centered>
      <FileQuestion className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">This kind of file opens outside the browser</p>
      <Button asChild variant="outline" className="mt-1">
        <a href={url} download={file.name}>
          <Download className="size-4" /> Download
        </a>
      </Button>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {children}
    </div>
  );
}
