"use client";

import { createContext, useContext } from "react";
import type { DocumentRenderContext, DocumentTemplateContent, DocumentTemplateKind } from "@bitcrm/types";

/**
 * Rarely-changing inputs shared by every block on the canvas: the render
 * context (sample data + resolved asset URLs) and the page/visibility the
 * renderer needs for block HTML.
 */
export interface CanvasEnv {
  kind: DocumentTemplateKind;
  ctx: DocumentRenderContext;
  /** `page` + `visibility` with empty sections — enough for `renderBlockHtml`. */
  tpl: DocumentTemplateContent;
  readOnly: boolean;
}

export const CanvasEnvContext = createContext<CanvasEnv | null>(null);

export function useCanvasEnv(): CanvasEnv {
  const env = useContext(CanvasEnvContext);
  if (!env) throw new Error("useCanvasEnv must be used inside the template canvas");
  return env;
}
