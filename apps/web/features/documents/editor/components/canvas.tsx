"use client";

import { useEffect, useMemo, useState } from "react";
import type { DocumentRenderContext } from "@bitcrm/types";
import { rendererCanvasCss, rendererFontHref } from "../../lib";
import { useEditorStore } from "../store";
import { useEditorUi } from "../ui-store";
import { PAPER_PX } from "../../components/document-thumbnail";
import { CanvasEnvContext, type CanvasEnv } from "./canvas-context";
import { SectionZone } from "./canvas-rows";

const SCOPE = ".doc-canvas";

/** Editor-only styling layered over the renderer's (scoped) document CSS. */
const CANVAS_CSS = `
${SCOPE}{position:relative}
${SCOPE} .paper{max-width:none;position:relative}
${SCOPE} .blk-wrap + .blk-wrap{margin-top:6px}
${SCOPE} .blk-wrap:focus-visible{outline:2px solid #0ea5e9;outline-offset:2px}
${SCOPE} .doc-header,${SCOPE} .doc-body,${SCOPE} .doc-footer{min-height:24px}
${SCOPE} .canvas-chrome{font-family:ui-sans-serif,system-ui,sans-serif;line-height:1;letter-spacing:0;font-weight:500;text-align:left}
${SCOPE} .canvas-hint{font-size:11px;color:#94a3b8;font-style:italic;padding:4px 0}
${SCOPE} .rt-placeholder{color:#9ca3af;font-style:italic}
${SCOPE} .merge-chip{display:inline-block;padding:0 .35em;margin:0 1px;border-radius:4px;background:rgba(37,99,235,.10);color:#1d4ed8;box-shadow:inset 0 0 0 1px rgba(37,99,235,.28);font-size:.92em;line-height:1.35;white-space:nowrap;cursor:default;user-select:none}
${SCOPE} .ProseMirror{outline:none;min-height:1.2em;white-space:pre-wrap;word-wrap:break-word}
${SCOPE} .ProseMirror-selectednode.merge-chip,${SCOPE} .merge-chip.ProseMirror-selectednode{background:rgba(37,99,235,.28)}
${SCOPE} .ProseMirror p.is-editor-empty:first-child::before{content:attr(data-placeholder);color:#9ca3af;float:left;height:0;pointer-events:none}
${SCOPE} .tbl td.cell-editable,${SCOPE} .tbl th.cell-editable{cursor:text}
${SCOPE} .tbl td.cell-editable:hover,${SCOPE} .tbl th.cell-editable:hover{background:rgba(250,204,21,.08)}
${SCOPE} .tbl .cell-active{box-shadow:inset 0 0 0 2px #f59e0b}
${SCOPE} a{pointer-events:none}
`;

function useElementWidth<T extends Element>() {
  const [el, ref] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return { ref, width };
}

/**
 * The interactive page: header / body / footer zones on paper-sized sheet,
 * styled with the renderer's own CSS so it matches the PDF.
 */
export function TemplateCanvas({ ctx, readOnly = false }: { ctx: DocumentRenderContext; readOnly?: boolean }) {
  const content = useEditorStore((s) => s.draft?.content);
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const zoomSetting = useEditorUi((s) => s.zoom);
  const { ref, width } = useElementWidth<HTMLDivElement>();

  const page = content?.page;
  const visibility = content?.visibility;
  const css = useMemo(() => (page ? `${rendererCanvasCss(page, SCOPE)}\n${CANVAS_CSS}` : ""), [page]);
  const fontHref = useMemo(() => (page ? rendererFontHref(page) : null), [page]);
  const env = useMemo<CanvasEnv | null>(
    () =>
      page && visibility
        ? { kind, ctx, readOnly, tpl: { page, visibility, header: [], body: [], footer: [] } }
        : null,
    [kind, ctx, readOnly, page, visibility],
  );

  if (!content || !env) return null;

  const paperWidth = PAPER_PX[content.page.size === "a4" ? "a4" : "letter"].width;
  // Leave room for the section labels in the gutter.
  const fit = width ? Math.min(1, Math.max(0.3, (width - 120) / paperWidth)) : 1;
  const zoom = zoomSetting === "fit" ? fit : zoomSetting;

  return (
    <CanvasEnvContext.Provider value={env}>
      {fontHref ? <link rel="stylesheet" href={fontHref} precedence="default" /> : null}
      <style>{css}</style>
      <div
        ref={ref}
        className="doc-canvas min-h-full"
        onClick={() => {
          if (!readOnly) useEditorStore.getState().select(null);
        }}
      >
        <div className="paper" style={{ zoom }}>
          <SectionZone section="header" rows={content.header} />
          <SectionZone section="body" rows={content.body} />
          <SectionZone section="footer" rows={content.footer} />
        </div>
      </div>
    </CanvasEnvContext.Provider>
  );
}
