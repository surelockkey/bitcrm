"use client";

import { create } from "zustand";
import type { Editor } from "@tiptap/react";
import type { PreviewSourceOption } from "../api";
import type { DropHint } from "./dnd";

export type EditorMode = "edit" | "preview";
export type LeftTab = "design" | "layout" | "tools" | "values" | "visibility" | "settings";
/** `fit` scales the paper to the canvas width (capped at 100%). */
export type Zoom = "fit" | 0.5 | 0.75 | 1 | 1.25;

interface EditorUiState {
  mode: EditorMode;
  leftTab: LeftTab;
  zoom: Zoom;
  /** A real invoice/estimate to preview with; null ⇒ sample data. */
  previewSource: PreviewSourceOption | null;
  /** Insertion line shown while dragging. */
  dropHint: DropHint;
  /** The mounted TipTap editor (a selected text block or table cell). */
  textEditor: Editor | null;
  setMode: (mode: EditorMode) => void;
  setLeftTab: (tab: LeftTab) => void;
  setZoom: (zoom: Zoom) => void;
  setPreviewSource: (source: PreviewSourceOption | null) => void;
  setDropHint: (hint: DropHint) => void;
  setTextEditor: (editor: Editor | null) => void;
  reset: () => void;
}

const sameHint = (a: DropHint, b: DropHint) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    a.index === b.index &&
    (a.kind === "row" ? a.section === (b as typeof a).section : a.columnId === (b as typeof a).columnId));

export const useEditorUi = create<EditorUiState>()((set, get) => ({
  mode: "edit",
  leftTab: "tools",
  zoom: "fit",
  previewSource: null,
  dropHint: null,
  textEditor: null,
  setMode: (mode) => set({ mode }),
  setLeftTab: (leftTab) => set({ leftTab }),
  setZoom: (zoom) => set({ zoom }),
  setPreviewSource: (previewSource) => set({ previewSource }),
  setDropHint: (dropHint) => {
    if (!sameHint(get().dropHint, dropHint)) set({ dropHint });
  },
  setTextEditor: (textEditor) => set({ textEditor }),
  reset: () => set({ mode: "edit", previewSource: null, dropHint: null, textEditor: null }),
}));
