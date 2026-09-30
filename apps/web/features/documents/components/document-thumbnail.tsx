"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentRenderContext, DocumentTemplateContent } from "@bitcrm/types";
import { renderDocumentHtml } from "@bitcrm/document-renderer";
import { cn } from "@/lib/utils";

/** CSS px of each paper size at 96dpi. */
export const PAPER_PX = {
  letter: { width: 816, height: 1056 },
  a4: { width: 794, height: 1123 },
} as const;

const THUMB_OVERRIDES = "<style>html{background:#fff}body{padding:0}.paper{box-shadow:none;border-radius:0}</style>";

/** Renderer HTML without the screen-mode desk background (for thumbnails). */
export function thumbnailHtml(content: DocumentTemplateContent, ctx: DocumentRenderContext): string {
  return renderDocumentHtml(content, ctx, { mode: "screen" }).replace("</head>", `${THUMB_OVERRIDES}</head>`);
}

/** True once the element has scrolled near the viewport (always true without IntersectionObserver). */
export function useInView<T extends Element>(rootMargin = "200px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (inView || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}

function useWidth<T extends Element>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * A scaled-down, non-interactive page preview. The iframe is sandboxed (no
 * scripts, opaque origin) and renders at full paper size, then scales to fit.
 */
export const DocumentThumbnail = memo(function DocumentThumbnail({
  content,
  ctx,
  title,
  className,
}: {
  content: DocumentTemplateContent | undefined;
  ctx: DocumentRenderContext;
  title: string;
  className?: string;
}) {
  const size = content?.page?.size === "a4" ? PAPER_PX.a4 : PAPER_PX.letter;
  const { ref, width } = useWidth<HTMLDivElement>();
  const html = useMemo(() => (content ? thumbnailHtml(content, ctx) : null), [content, ctx]);
  const scale = width ? width / size.width : 0;

  return (
    <div
      ref={ref}
      className={cn("relative w-full overflow-hidden bg-white", className)}
      style={{ aspectRatio: `${size.width} / ${size.height}` }}
    >
      {html ? (
        <iframe
          title={title}
          srcDoc={html}
          sandbox=""
          tabIndex={-1}
          aria-hidden
          className={cn("pointer-events-none absolute top-0 left-0 origin-top-left border-0 transition-opacity", !scale && "opacity-0")}
          style={{ width: size.width, height: size.height, transform: `scale(${scale || 0.01})` }}
        />
      ) : (
        <div className="absolute inset-0 animate-pulse bg-muted/60" />
      )}
    </div>
  );
});
