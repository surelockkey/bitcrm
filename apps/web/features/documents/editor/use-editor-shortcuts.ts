"use client";

import { useEffect, useRef } from "react";
import { useEditorStore } from "./store";
import { useEditorUi } from "./ui-store";

export const LEAVE_MESSAGE = "You have unsaved changes to this template. Leave without saving?";

/** True when the key event comes from a form field or an inline text editor. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "color", "range"].includes(type);
  }
  return false;
}

function inRichText(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest(".ProseMirror");
}

/**
 * Editor keyboard shortcuts: Cmd/Ctrl+S save, Cmd/Ctrl+Z / Shift+Z / Y
 * undo/redo (the rich-text editors have no history of their own),
 * Delete/Backspace removes the selected block, Cmd/Ctrl+D duplicates it,
 * Escape clears the selection.
 */
export function useEditorShortcuts({ onSave, enabled }: { onSave: () => void; enabled: boolean }) {
  const saveRef = useRef(onSave);
  useEffect(() => {
    saveRef.current = onSave;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const store = useEditorStore.getState();
      if (mod && key === "s") {
        e.preventDefault();
        saveRef.current();
        return;
      }
      // Native undo inside inputs; the store's history everywhere else (incl. rich text).
      const typingInField = isTypingTarget(e.target) && !inRichText(e.target);
      if (mod && !e.altKey && (key === "z" || key === "y") && !typingInField) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) store.redo();
        else store.undo();
        return;
      }
      if (useEditorUi.getState().mode !== "edit" || isTypingTarget(e.target)) return;
      const sel = store.selection;
      if ((e.key === "Delete" || e.key === "Backspace") && sel?.type === "block") {
        e.preventDefault();
        store.removeBlock(sel.id);
      } else if (mod && key === "d" && sel?.type === "block") {
        e.preventDefault();
        store.duplicateBlock(sel.id);
      } else if (e.key === "Escape" && sel) {
        store.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/**
 * Warns before leaving with unsaved changes: browser unload, and in-app link
 * clicks (intercepted in the capture phase, before Next's router sees them).
 */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
