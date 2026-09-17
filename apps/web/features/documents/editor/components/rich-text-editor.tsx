"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { RichTextNode } from "@bitcrm/types";
import { richTextExtensions } from "../merge-tag-extension";
import { sanitizeRichText } from "../rich-text";
import { useEditorUi } from "../ui-store";

export interface FocusPoint {
  x: number;
  y: number;
}

function focusAt(editor: Editor, point: FocusPoint | undefined) {
  let pos: number | "end" = "end";
  if (point) {
    try {
      pos = editor.view.posAtCoords({ left: point.x, top: point.y })?.pos ?? "end";
    } catch {
      pos = "end";
    }
  }
  editor.commands.focus(pos, { scrollIntoView: false });
}

/**
 * Inline TipTap editor for a text block or table cell. Emits allow-listed
 * JSON; external value changes (undo/redo) are applied without echoing back.
 * While mounted it is the "active" editor the toolbar and Values panel target.
 */
export function RichTextEditor({
  value,
  onChange,
  ariaLabel,
  placeholder = "Type something…",
  focus,
  onEscape,
  className,
}: {
  value: RichTextNode;
  onChange: (value: RichTextNode) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Focus on mount, at the clicked point when given. */
  focus?: boolean | FocusPoint;
  onEscape?: () => void;
  className?: string;
}) {
  const onChangeRef = useRef(onChange);
  const onEscapeRef = useRef(onEscape);
  const lastJson = useRef(JSON.stringify(value));
  // Only the first value/focus matter: later values are synced below.
  const [initial] = useState({ value, focus });
  useEffect(() => {
    onChangeRef.current = onChange;
    onEscapeRef.current = onEscape;
  });

  const extensions = useMemo(() => richTextExtensions(placeholder), [placeholder]);

  const editor = useEditor({
    extensions,
    content: initial.value,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { "aria-label": ariaLabel, role: "textbox", "aria-multiline": "true", class: className ?? "" },
      handleKeyDown: (_view, event) => {
        if (event.key === "Escape") {
          onEscapeRef.current?.();
          return true;
        }
        return false;
      },
    },
    onCreate: ({ editor: e }) => {
      const f = initial.focus;
      if (f) focusAt(e, typeof f === "object" ? f : undefined);
    },
    onUpdate: ({ editor: e }) => {
      const json = sanitizeRichText(e.getJSON());
      const str = JSON.stringify(json);
      if (str === lastJson.current) return;
      lastJson.current = str;
      onChangeRef.current(json);
    },
  });

  // Register as the active editor for the toolbar / Values panel.
  useEffect(() => {
    if (!editor) return;
    useEditorUi.getState().setTextEditor(editor);
    return () => {
      if (useEditorUi.getState().textEditor === editor) useEditorUi.getState().setTextEditor(null);
    };
  }, [editor]);

  // Apply external changes (undo/redo, another panel) without emitting.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const str = JSON.stringify(value);
    if (str === lastJson.current) return;
    lastJson.current = str;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  return <EditorContent editor={editor} className="rt-editor" />;
}
