"use client";

/**
 * Template editor state: the draft being edited, the selection, and an
 * undo/redo history of whole drafts (cheap thanks to structural sharing).
 *
 * Server data (the saved template) lives in React Query; this store only holds
 * the local working copy. `saved` is the draft object that was last loaded or
 * saved, so "dirty" is a reference comparison — undoing back to the saved
 * state makes the editor clean again.
 */
import { create } from "zustand";
import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentPageSettings,
  DocumentTemplate,
  DocumentTemplateContent,
  DocumentTemplateKind,
  DocumentVisibility,
} from "@bitcrm/types";
import { DEFAULT_DOCUMENT_VISIBILITY } from "@bitcrm/types";
import { createBlock, createTemplateContent } from "@bitcrm/document-renderer";
import * as tree from "./tree";
import type { BlockPatch, ColumnPatch, RowPatch, SectionId } from "./tree";

export const HISTORY_LIMIT = 100;
/** Edits sharing a coalesce key within this window become one undo step. */
export const COALESCE_WINDOW_MS = 1000;

export interface AutoApply {
  jobTypeIds: string[];
  serviceAreaIds: string[];
  businessProfileIds: string[];
}

export interface TemplateDraft {
  name: string;
  kind: DocumentTemplateKind;
  content: DocumentTemplateContent;
  autoApply: AutoApply;
}

export type Selection = { type: "row"; id: string } | { type: "block"; id: string } | null;

export type ActionResult = { ok: true } | { ok: false; error: string };

export interface EditOptions {
  /** Merge with the previous history step when it used the same key recently. */
  coalesce?: string;
}

export interface BlockTarget {
  columnId: string;
  index?: number;
}

export interface EditorState {
  templateId: string | null;
  version: number;
  draft: TemplateDraft | null;
  saved: TemplateDraft | null;
  past: TemplateDraft[];
  future: TemplateDraft[];
  lastEdit: { key: string; at: number } | null;
  selection: Selection;
  activeSection: SectionId;
  activeColumnId: string | null;

  load: (template: DocumentTemplate) => void;
  reset: () => void;
  markSaved: (version: number, snapshot: TemplateDraft) => void;
  undo: () => void;
  redo: () => void;

  select: (selection: Selection) => void;
  setActiveSection: (section: SectionId) => void;
  setActiveColumn: (columnId: string | null) => void;

  addRow: (section: SectionId, spans: number[], index?: number) => ActionResult;
  moveRow: (rowId: string, section: SectionId, index: number) => ActionResult;
  updateRow: (rowId: string, patch: RowPatch, opts?: EditOptions) => ActionResult;
  updateColumn: (columnId: string, patch: ColumnPatch, opts?: EditOptions) => ActionResult;
  setRowLayout: (rowId: string, spans: number[]) => ActionResult;
  duplicateRow: (rowId: string) => ActionResult;
  removeRow: (rowId: string) => ActionResult;

  addBlock: (type: DocumentBlockType | DocumentBlock, target?: BlockTarget) => ActionResult;
  moveBlock: (blockId: string, columnId: string, index: number) => ActionResult;
  updateBlock: (blockId: string, patch: BlockPatch, opts?: EditOptions) => ActionResult;
  duplicateBlock: (blockId: string) => ActionResult;
  removeBlock: (blockId: string) => ActionResult;

  updatePage: (patch: Partial<DocumentPageSettings>, opts?: EditOptions) => ActionResult;
  updateVisibility: (patch: Partial<DocumentVisibility>) => ActionResult;
  updateAutoApply: (patch: Partial<AutoApply>) => ActionResult;
  rename: (name: string) => ActionResult;
  loadPreset: (presetId: string) => ActionResult;
}

const OK: ActionResult = { ok: true };

type Wrapped = { draft: TemplateDraft; extra?: Partial<EditorState> };
const isWrapped = (o: TemplateDraft | Wrapped): o is Wrapped => "draft" in o;

function errorResult(e: unknown): ActionResult {
  if (e instanceof tree.EditorLimitError) return { ok: false, error: e.message };
  if (e instanceof Error) return { ok: false, error: e.message };
  return { ok: false, error: "That change couldn't be applied." };
}

/** The editable part of a template. */
export function templateToDraft(t: DocumentTemplate): TemplateDraft {
  return {
    name: t.name,
    kind: t.kind,
    content: {
      page: t.page,
      header: t.header ?? [],
      body: t.body ?? [],
      footer: t.footer ?? [],
      visibility: { ...DEFAULT_DOCUMENT_VISIBILITY, ...(t.visibility ?? {}) },
    },
    autoApply: {
      jobTypeIds: t.autoApply?.jobTypeIds ?? [],
      serviceAreaIds: t.autoApply?.serviceAreaIds ?? [],
      businessProfileIds: t.autoApply?.businessProfileIds ?? [],
    },
  };
}

export const selectIsDirty = (s: Pick<EditorState, "draft" | "saved">): boolean => s.draft !== s.saved;
export const selectCanUndo = (s: Pick<EditorState, "past">): boolean => s.past.length > 0;
export const selectCanRedo = (s: Pick<EditorState, "future">): boolean => s.future.length > 0;

const INITIAL = {
  templateId: null,
  version: 0,
  draft: null,
  saved: null,
  past: [],
  future: [],
  lastEdit: null,
  selection: null,
  activeSection: "body" as SectionId,
  activeColumnId: null,
};

export function createEditorStore() {
  return create<EditorState>()((set, get) => {
    /**
     * Applies `fn` to the draft and records history. `fn` may return extra
     * state (e.g. a new selection) alongside the next draft.
     */
    function commit(
      fn: (draft: TemplateDraft) => TemplateDraft | Wrapped,
      opts: EditOptions = {},
    ): ActionResult {
      const { draft, past, lastEdit } = get();
      if (!draft) return { ok: false, error: "Nothing to edit." };
      let out: ReturnType<typeof fn>;
      try {
        out = fn(draft);
      } catch (e) {
        return errorResult(e);
      }
      const next = isWrapped(out) ? out.draft : out;
      const extra = isWrapped(out) ? (out.extra ?? {}) : {};
      if (next === draft) {
        if (Object.keys(extra).length) set(extra);
        return OK;
      }
      const now = Date.now();
      const merge = !!opts.coalesce && lastEdit?.key === opts.coalesce && now - lastEdit.at < COALESCE_WINDOW_MS && past.length > 0;
      const nextPast = merge ? past : [...past, draft].slice(-HISTORY_LIMIT);
      set({
        draft: next,
        past: nextPast,
        future: [],
        lastEdit: opts.coalesce ? { key: opts.coalesce, at: now } : null,
        ...extra,
      });
      return OK;
    }

    const editContent = (fn: (c: DocumentTemplateContent) => DocumentTemplateContent, opts?: EditOptions) =>
      commit((d) => {
        const content = fn(d.content);
        return content === d.content ? d : { ...d, content };
      }, opts);

    /** Drops a selection whose target no longer exists. */
    function pruneSelection(content: DocumentTemplateContent): Partial<EditorState> {
      const { selection, activeColumnId } = get();
      const out: Partial<EditorState> = {};
      if (selection?.type === "row" && !tree.findRow(content, selection.id)) out.selection = null;
      if (selection?.type === "block" && !tree.findBlock(content, selection.id)) out.selection = null;
      if (activeColumnId && !tree.findColumn(content, activeColumnId)) out.activeColumnId = null;
      return out;
    }

    return {
      ...INITIAL,

      load: (template) => {
        const draft = templateToDraft(template);
        set({ ...INITIAL, templateId: template.id, version: template.version, draft, saved: draft });
      },

      reset: () => set({ ...INITIAL }),

      markSaved: (version, snapshot) => set({ version, saved: snapshot, lastEdit: null }),

      undo: () => {
        const { past, draft, future } = get();
        if (!past.length || !draft) return;
        const prev = past[past.length - 1];
        set({ draft: prev, past: past.slice(0, -1), future: [draft, ...future], lastEdit: null, ...pruneSelection(prev.content) });
      },

      redo: () => {
        const { past, draft, future } = get();
        if (!future.length || !draft) return;
        const [next, ...rest] = future;
        set({ draft: next, past: [...past, draft].slice(-HISTORY_LIMIT), future: rest, lastEdit: null, ...pruneSelection(next.content) });
      },

      select: (selection) => {
        const content = get().draft?.content;
        if (!selection || !content) return set({ selection });
        if (selection.type === "block") {
          const loc = tree.findBlock(content, selection.id);
          if (!loc) return;
          const col = content[loc.section][loc.rowIndex].columns[loc.colIndex];
          return set({ selection, activeColumnId: col.id, activeSection: loc.section });
        }
        const loc = tree.findRow(content, selection.id);
        if (!loc) return;
        const row = content[loc.section][loc.index];
        const keep = row.columns.some((c) => c.id === get().activeColumnId);
        set({ selection, activeSection: loc.section, activeColumnId: keep ? get().activeColumnId : (row.columns[0]?.id ?? null) });
      },

      setActiveSection: (activeSection) => set({ activeSection }),

      setActiveColumn: (columnId) => {
        const content = get().draft?.content;
        const loc = columnId && content ? tree.findColumn(content, columnId) : null;
        set(loc ? { activeColumnId: columnId, activeSection: loc.section } : { activeColumnId: null });
      },

      addRow: (section, spans, index) =>
        commit((d) => {
          const { content, row } = tree.addRow(d.content, section, spans, index);
          return {
            draft: { ...d, content },
            extra: { selection: { type: "row", id: row.id }, activeSection: section, activeColumnId: row.columns[0].id },
          };
        }),

      moveRow: (rowId, section, index) => editContent((c) => tree.moveRow(c, rowId, section, index)),

      updateRow: (rowId, patch, opts) => editContent((c) => tree.updateRow(c, rowId, patch), opts),

      updateColumn: (columnId, patch, opts) => editContent((c) => tree.updateColumn(c, columnId, patch), opts),

      setRowLayout: (rowId, spans) =>
        commit((d) => {
          const content = tree.setRowLayout(d.content, rowId, spans);
          return { draft: { ...d, content }, extra: pruneSelection(content) };
        }),

      duplicateRow: (rowId) =>
        commit((d) => {
          const { content, row } = tree.duplicateRow(d.content, rowId);
          return { draft: { ...d, content }, extra: { selection: { type: "row", id: row.id } } };
        }),

      removeRow: (rowId) =>
        commit((d) => {
          const content = tree.removeRow(d.content, rowId);
          return { draft: { ...d, content }, extra: pruneSelection(content) };
        }),

      addBlock: (typeOrBlock, target) =>
        commit((d) => {
          const block = typeof typeOrBlock === "string" ? createBlock(typeOrBlock) : typeOrBlock;
          const { selection, activeColumnId, activeSection } = get();
          let content = d.content;
          let columnId = target?.columnId ?? null;
          let index = target?.index;
          if (!columnId && activeColumnId && tree.findColumn(content, activeColumnId)) {
            columnId = activeColumnId;
            if (selection?.type === "block") {
              const loc = tree.findBlock(content, selection.id);
              const col = loc ? content[loc.section][loc.rowIndex].columns[loc.colIndex] : null;
              if (loc && col?.id === columnId) index = loc.blockIndex + 1;
            }
          }
          if (!columnId) {
            const added = tree.addRow(content, activeSection, [12]);
            content = added.content;
            columnId = added.row.columns[0].id;
          }
          content = tree.addBlock(content, columnId, block, index);
          const loc = tree.findColumn(content, columnId);
          return {
            draft: { ...d, content },
            extra: {
              selection: { type: "block", id: block.id },
              activeColumnId: columnId,
              ...(loc ? { activeSection: loc.section } : {}),
            },
          };
        }),

      moveBlock: (blockId, columnId, index) =>
        commit((d) => {
          const content = tree.moveBlock(d.content, blockId, columnId, index);
          const moved = content !== d.content && get().selection?.type === "block" && get().selection?.id === blockId;
          return { draft: content === d.content ? d : { ...d, content }, extra: moved ? { activeColumnId: columnId } : {} };
        }),

      updateBlock: (blockId, patch, opts) => editContent((c) => tree.updateBlock(c, blockId, patch), opts),

      duplicateBlock: (blockId) =>
        commit((d) => {
          const { content, block } = tree.duplicateBlock(d.content, blockId);
          return { draft: { ...d, content }, extra: { selection: { type: "block", id: block.id } } };
        }),

      removeBlock: (blockId) =>
        commit((d) => {
          const content = tree.removeBlock(d.content, blockId);
          return { draft: { ...d, content }, extra: pruneSelection(content) };
        }),

      updatePage: (patch, opts) =>
        editContent((c) => (Object.entries(patch).every(([k, v]) => c.page[k as keyof DocumentPageSettings] === v) ? c : { ...c, page: { ...c.page, ...patch } }), opts),

      updateVisibility: (patch) =>
        editContent((c) => (Object.entries(patch).every(([k, v]) => c.visibility[k as keyof DocumentVisibility] === v) ? c : { ...c, visibility: { ...c.visibility, ...patch } })),

      updateAutoApply: (patch) => commit((d) => ({ ...d, autoApply: { ...d.autoApply, ...patch } })),

      rename: (name) => commit((d) => (d.name === name ? d : { ...d, name })),

      loadPreset: (presetId) =>
        commit((d) => {
          const preset = createTemplateContent(d.kind, presetId);
          return {
            draft: { ...d, content: { ...preset, visibility: d.content.visibility } },
            extra: { selection: null, activeColumnId: null, activeSection: "body" },
          };
        }),
    };
  });
}

export type EditorStore = ReturnType<typeof createEditorStore>;

/** The app has one template editor at a time; `load` resets it. */
export const useEditorStore = createEditorStore();
