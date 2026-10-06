"use client";

import { useEffect, useState } from "react";

/**
 * Whether every picture in `srcs` is in the browser's hands — loaded, failed,
 * or past `timeoutMs` — so a page can hold its skeleton until then.
 *
 * An `<img>` sized by its own picture has no size until its bytes arrive, and
 * then takes its room and shoves whatever sits beside or below it. Asked for
 * here first, the pictures are already there when the page is put up, and
 * its first frame lays them out at their size. Nothing to load is ready at
 * once; a picture that never answers holds the page no longer than the timeout.
 */
export function useImagesReady(srcs: readonly string[], timeoutMs = 2000): boolean {
  const key = [...new Set(srcs.filter(Boolean))].sort().join("\n");
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    if (!key) return;
    let live = true;
    const pending = new Set(key.split("\n"));
    const images: HTMLImageElement[] = [];
    const finish = () => {
      if (live) setDoneFor(key);
    };
    for (const src of pending) {
      const img = new Image();
      const settle = () => {
        pending.delete(src);
        if (pending.size === 0) finish();
      };
      img.onload = settle;
      img.onerror = settle;
      img.src = src;
      images.push(img);
    }
    const timer = setTimeout(finish, timeoutMs);
    return () => {
      live = false;
      clearTimeout(timer);
      for (const img of images) {
        img.onload = null;
        img.onerror = null;
      }
    };
  }, [key, timeoutMs]);

  return !key || doneFor === key;
}
