"use client";

import { useEffect, useState } from "react";

/**
 * Whether the image at `src` is in the browser's hands — loaded, failed, or
 * taking longer than `timeoutMs` — so a page can hold its skeleton until then.
 *
 * An `<img>` sized by its own picture (`h-10 w-auto`) has no width until its
 * bytes arrive, and then takes its room and shoves whatever sits beside it.
 * Asked for here first, the picture is already there when the `<img>` is put
 * up, and the first frame lays it out at its size. A missing `src` is ready at
 * once; a picture that never answers holds the page no longer than the timeout.
 */
export function useImageReady(src: string | undefined, timeoutMs = 2000): boolean {
  const [doneFor, setDoneFor] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;
    let live = true;
    const img = new Image();
    const done = () => {
      if (live) setDoneFor(src);
    };
    img.onload = done;
    img.onerror = done;
    img.src = src;
    const timer = setTimeout(done, timeoutMs);
    return () => {
      live = false;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };
  }, [src, timeoutMs]);

  return !src || doneFor === src;
}
