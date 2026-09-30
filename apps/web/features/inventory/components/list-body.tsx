"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * The body of an inventory list: the area its table (or its empty or error
 * card) is drawn in, and the pager under it.
 *
 * **A new search doesn't pull the pager up.** Fifty rows narrowed to two took
 * the pager from below the fold up into the middle of the screen; the next
 * search sent it back down (CLS 0.048 on a desktop, 0.059 on a phone). So
 * when the filter changes, the area holds the part of the screen it filled —
 * its own height, cut at the bottom of the screen — and the new rows are
 * drawn in it: a short result leaves the pager where it was, or just below
 * the fold. Never more than a screen, so a short list never trails a page of
 * blank; measured again at the next search, never carried over.
 *
 * **A new page starts at its top.** After Next the view stayed at the bottom
 * of the new page, its first rows a screen and a half above; the area scrolls
 * into view — smoothly, and only when its top is off-screen (under the sticky
 * header counts: `scroll-mt-16` is the header's height and a little air).
 */
export function ListBody({
  holdKey,
  scrollKey,
  pager,
  children,
}: {
  /** The filter the rows answer — search, category, status… A new one holds the area. */
  holdKey: string;
  /** The page on screen (and its size). A new one brings the list's top into view. */
  scrollKey: string;
  /** Drawn under the area — never inside the held height. */
  pager?: ReactNode;
  children: ReactNode;
}) {
  const area = useRef<HTMLDivElement>(null);
  // The previous frame's filter and height: a new filter is held at what was
  // on screen before it — measured after the change it would already be gone
  // when the answer came from the cache.
  const last = useRef<{ key: string; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const prev = last.current;
    if (prev && prev.key !== holdKey) {
      const top = el.getBoundingClientRect().top;
      const onScreen = Math.max(0, Math.ceil(window.innerHeight - top));
      const hold = Math.min(prev.height, onScreen);
      // Set on the element, before paint: no frame at the shorter height.
      el.style.minHeight = hold > 0 ? `${hold}px` : "";
    }
    last.current = { key: holdKey, height: el.getBoundingClientRect().height };
  });

  const seenPage = useRef(scrollKey);
  useEffect(() => {
    if (seenPage.current === scrollKey) return;
    seenPage.current = scrollKey;
    const el = area.current;
    if (!el) return;
    const margin = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (el.getBoundingClientRect().top >= margin) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }, [scrollKey]);

  return (
    <>
      <div ref={area} data-slot="list-area" className="scroll-mt-16">
        {children}
      </div>
      {pager}
    </>
  );
}
