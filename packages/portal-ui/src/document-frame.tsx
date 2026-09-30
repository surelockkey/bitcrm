"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Narrower than this the page is reflowed for reading instead of shown as a sheet of paper. */
export const COMPACT_BELOW = 720;

/**
 * Reader mode for phones. A document is laid out as a letter-size sheet (12-column
 * rows, inch margins); on a 375px screen that is either unreadably small or
 * squeezed. Stack the columns, drop the sheet chrome and let the line-item table
 * breathe instead. `!important` because the renderer writes column spans inline.
 */
const READER_CSS = `
html{background:#fff !important}
body{padding:0 !important}
.paper{width:auto !important;max-width:100% !important;min-height:0 !important;margin:0 !important;padding:20px 16px 28px !important;box-shadow:none !important;border-radius:0 !important}
.row{grid-template-columns:minmax(0,1fr) !important;row-gap:14px}
.col{grid-column:1 / -1 !important}
.field-value{overflow-wrap:anywhere}
.items th,.items td{padding-left:4px !important;padding-right:4px !important}
.items{font-size:.94em}
.logo,.img{max-width:70% !important}
`;

/** Adds `<base target=_blank>` (a link must never navigate the frame) and, when compact, the reader CSS. */
export function prepareDocumentHtml(html: string, compact: boolean): string {
  const inject = `<base target="_blank">${compact ? `<style>${READER_CSS}</style>` : ""}`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${inject}`);
  return `${inject}${html}`;
}

/**
 * A document's HTML render, filling the width it is given and as tall as its
 * content — the page scrolls, not the frame. The document is the server's own
 * render (the same template as the PDF), so this is what the PDF will look like.
 *
 * Sandboxed with no scripts: `allow-same-origin` only lets us read the frame's
 * height; nothing inside can run code.
 */
export function DocumentFrame({ html, title }: { html: string; title: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const bodyObserver = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [height, setHeight] = useState(360);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? null));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => bodyObserver.current?.disconnect(), []);

  const compact = width !== null && width < COMPACT_BELOW;
  const srcDoc = useMemo(() => prepareDocumentHtml(html, compact), [html, compact]);

  const measure = useCallback(() => {
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const fit = () => setHeight(Math.max(240, Math.ceil(body.getBoundingClientRect().height)));
    fit();
    // Web fonts and images settle after load; the frame follows the content.
    bodyObserver.current?.disconnect();
    bodyObserver.current = new ResizeObserver(fit);
    bodyObserver.current.observe(body);
  }, []);

  return (
    <div ref={wrap} className="mx-auto w-full">
      {width === null ? null : (
        <iframe
          ref={frame}
          title={title}
          srcDoc={srcDoc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={measure}
          className="block w-full border-0"
          style={{ height, colorScheme: "light" }}
        />
      )}
    </div>
  );
}
