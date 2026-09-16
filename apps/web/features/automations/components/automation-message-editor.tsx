"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { cn } from "@/lib/utils";
import { messageSegments } from "../lib";

/** Marks the chip elements apart from anything a browser slips into the box. */
const CHIP = "data-short-code";
const RAW = "data-raw";

/**
 * The editor's DOM back as the body the renderer takes. Only two kinds of
 * node are ever put in — text and chips — so anything else is whatever the
 * browser added on its own: a `<br>` counts as a newline, a stray wrapper
 * as its text. A `<br>` the browser parks at the very end to keep an empty
 * line editable is not part of the message and is dropped.
 */
export function serializeMessage(root: HTMLElement): string {
  const nodes = Array.from(root.childNodes);
  while (nodes.length && (nodes[nodes.length - 1] as HTMLElement)?.tagName === "BR") nodes.pop();
  return nodes
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      const el = node as HTMLElement;
      if (el.hasAttribute?.(RAW)) return el.getAttribute(RAW) ?? "";
      if (el.tagName === "BR") return "\n";
      return el.textContent ?? "";
    })
    .join("");
}

function chipElement(doc: Document, code: string, raw: string): HTMLElement {
  const chip = doc.createElement("span");
  chip.setAttribute(CHIP, code);
  chip.setAttribute(RAW, raw);
  chip.setAttribute("contenteditable", "false");
  chip.className =
    "mx-0.5 inline-flex select-none items-center rounded bg-brand/10 px-1 py-px align-baseline font-mono text-[11px] text-brand ring-1 ring-brand/20";
  chip.textContent = raw;
  return chip;
}

const isChip = (node: Node | null | undefined): node is HTMLElement =>
  !!node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute(CHIP);

/**
 * How far into `node` a caret can sit — characters in a text node, children
 * in an element. The two are counted differently, and a remembered offset
 * clamped against the wrong one lands the caret somewhere nobody asked for.
 */
const caretLimit = (node: Node): number =>
  node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length;

export interface MessageEditorHandle {
  /** Drop `{{code}}` in as one chip, where the caret is (or was). */
  insertCode: (code: string) => void;
}

/**
 * The message body, with `{{short_codes}}` as atomic chips (Workiz stores
 * them as Draft.js `SHORT_CODE` entities — "immutable", §1.5.5). A variable
 * is one thing: one Backspace removes it whole, and no stray keystroke can
 * leave `{{job_dat}}` behind to be rendered as literal text on a customer's
 * phone.
 *
 * It is a plain labelled multiline textbox to anything reading the page, and
 * it is writable with the keyboard alone: type, press Enter for a newline,
 * and reach the short-code menu by Tab — inserting from it puts the chip
 * back where the caret was and returns focus to the text.
 */
export function AutomationMessageEditor({
  value,
  onChange,
  labelledBy,
  placeholder,
  disabled,
  describedBy,
  className,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Id of the `<label>` naming this box. */
  labelledBy: string;
  placeholder?: string;
  disabled?: boolean;
  describedBy?: string;
  className?: string;
  ref?: Ref<MessageEditorHandle>;
}) {
  const box = useRef<HTMLDivElement>(null);
  /** What the DOM currently spells — so an echo of our own `onChange` never rebuilds it under the caret. */
  const shown = useRef<string | null>(null);
  /** Where the caret was when focus left for the short-code menu. */
  const saved = useRef<{ node: Node; offset: number } | null>(null);

  const paint = useCallback((body: string) => {
    const root = box.current;
    if (!root) return;
    root.textContent = "";
    for (const segment of messageSegments(body)) {
      root.appendChild(
        segment.type === "code"
          ? chipElement(root.ownerDocument, segment.code, segment.raw)
          : root.ownerDocument.createTextNode(segment.text),
      );
    }
    shown.current = body;
  }, []);

  useEffect(() => {
    if (shown.current !== value) paint(value);
  }, [value, paint]);

  const remember = () => {
    const selection = box.current?.ownerDocument.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (range && box.current?.contains(range.startContainer)) {
      saved.current = { node: range.startContainer, offset: range.startOffset };
    }
  };

  const emit = () => {
    const root = box.current;
    if (!root) return;
    const next = serializeMessage(root);
    shown.current = next;
    onChange(next);
  };

  const caretAfter = (node: Node) => {
    const root = box.current;
    const selection = root?.ownerDocument.getSelection();
    if (!root || !selection) return;
    const range = root.ownerDocument.createRange();
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    saved.current = { node: range.startContainer, offset: range.startOffset };
  };

  /** Put `text` where the caret is (or was, when the menu took focus). */
  const insert = (node: Node) => {
    const root = box.current;
    if (!root || disabled) return;
    const doc = root.ownerDocument;
    const selection = doc.getSelection();
    const where = saved.current;
    const range = doc.createRange();
    if (where && root.contains(where.node)) {
      range.setStart(where.node, Math.min(where.offset, caretLimit(where.node)));
      range.collapse(true);
    } else {
      range.selectNodeContents(root);
      range.collapse(false);
    }
    range.insertNode(node);
    selection?.removeAllRanges();
    root.focus();
    caretAfter(node);
    emit();
  };

  useImperativeHandle(ref, () => ({
    insertCode: (code: string) => {
      const root = box.current;
      if (!root) return;
      insert(chipElement(root.ownerDocument, code, `{{${code}}}`));
      // The short-code menu is a dropdown, and a dropdown hands focus back to
      // its own trigger as it closes — after this call. Claiming it a tick
      // later leaves the caret where the chip just landed, so a keyboard user
      // carries on typing instead of tabbing back to the box first.
      setTimeout(() => {
        const after = saved.current;
        if (!box.current || !after || !box.current.contains(after.node)) return;
        box.current.focus();
        const range = box.current.ownerDocument.createRange();
        range.setStart(after.node, Math.min(after.offset, caretLimit(after.node)));
        range.collapse(true);
        const selection = box.current.ownerDocument.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }, 0);
    },
  }));

  /**
   * A chip is `contenteditable="false"`, which most browsers already delete
   * whole — but not all of them, and not predictably at a boundary. Doing it
   * here makes "one keystroke, one variable" the same everywhere.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const root = box.current;
    if (!root) return;
    if (e.key === "Enter") {
      // The browser's own Enter builds divs and brs; a newline keeps the DOM
      // to text and chips, which is what makes serialising exact.
      e.preventDefault();
      insert(root.ownerDocument.createTextNode("\n"));
      return;
    }
    if (e.key !== "Backspace" && e.key !== "Delete") return;
    const selection = root.ownerDocument.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !range.collapsed || !root.contains(range.startContainer)) return;

    const container = range.startContainer;
    const back = e.key === "Backspace";
    let victim: Node | null = null;
    if (container === root) {
      victim = root.childNodes[back ? range.startOffset - 1 : range.startOffset] ?? null;
    } else if (back && range.startOffset === 0) {
      victim = container.previousSibling;
    } else if (!back && range.startOffset === (container.textContent?.length ?? 0)) {
      victim = container.nextSibling;
    }
    if (!isChip(victim)) return;
    e.preventDefault();
    victim.remove();
    emit();
  };

  // Pasting HTML would smuggle in nodes nothing here knows how to serialise;
  // the text of it lands where the caret is, newlines and all.
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    remember();
    if (text) insert(box.current!.ownerDocument.createTextNode(text));
  };

  return (
    <div
      ref={box}
      role="textbox"
      aria-multiline="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      contentEditable={!disabled}
      suppressContentEditableWarning
      data-placeholder={placeholder}
      tabIndex={disabled ? -1 : 0}
      onInput={() => {
        emit();
        remember();
      }}
      onKeyDown={onKeyDown}
      onKeyUp={remember}
      onMouseUp={remember}
      onBlur={remember}
      onPaste={onPaste}
      className={cn(
        "min-h-20 w-full whitespace-pre-wrap break-words rounded-md border bg-transparent px-3 py-2 text-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    />
  );
}
