import { Node, mergeAttributes } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Color } from "@tiptap/extension-color";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { TextStyle } from "@tiptap/extension-text-style";
import { mergeTagLabel } from "../lib";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mergeTag: {
      /** Inserts a `{ type: 'mergeTag', attrs: { path } }` chip at the selection. */
      insertMergeTag: (path: string) => ReturnType;
    };
  }
}

/**
 * An inline, atomic merge-tag chip. Stored as `{ type: 'mergeTag', attrs: { path } }`
 * (the renderer's schema) and shown with its human label.
 */
export const MergeTag = Node.create({
  name: "mergeTag",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      path: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-merge-tag") ?? "",
        renderHTML: (attrs) => ({ "data-merge-tag": attrs.path }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-merge-tag]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const path = String(node.attrs.path ?? "");
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "merge-chip", contenteditable: "false", title: `{{${path}}}` }),
      mergeTagLabel(path),
    ];
  },

  renderText({ node }) {
    return `{{${String(node.attrs.path ?? "")}}}`;
  },

  addCommands() {
    return {
      insertMergeTag:
        (path) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { path } }),
    };
  },
});

/**
 * Only what the renderer understands: paragraphs, H1–H3, lists, hard breaks,
 * bold/italic/underline, text color and links. History is the editor store's.
 */
export function richTextExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      blockquote: false,
      codeBlock: false,
      code: false,
      strike: false,
      horizontalRule: false,
      undoRedo: false,
      link: false,
      trailingNode: false,
      dropcursor: false,
    }),
    TextStyle,
    Color,
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: [],
      defaultProtocol: "https",
      isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
    }),
    Placeholder.configure({ placeholder }),
    MergeTag,
  ];
}
