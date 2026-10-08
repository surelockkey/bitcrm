"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Redo2,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { noteToHtml } from "../note-html";

/**
 * The job note, written the way Workiz writes it: a toolbar over the box with
 * the block format, undo and redo, bold and italic, the two lists and a link.
 * Drawn as Workiz's MarkdownEditor (ToolbarPlugin / MarkdownEditor modules in
 * its main.css): a 1px #9ea6aa box with 4px corners (#566d76 while focused),
 * a #f3f6f7 toolbar over a #dfe2e3 rule, 28x32 #566d76 buttons with #e4ebed
 * hover and a #6aa8ee "on" fill, #9ea6aa dividers, and a 140px body of
 * 14px/1.5 #1a2b30 text that can be dragged taller.
 *
 * The note is stored as HTML, and 79,708 of them came over from Workiz as
 * plain text, so `noteToHtml` opens those as paragraphs rather than as one
 * run-on line. Anything that shows a note as words rather than markup goes
 * through `noteToText`.
 */
export function JobNoteEditor({
  value,
  onChange,
  editable = true,
  ariaLabel = "Notes",
  placeholder = "What needs doing…",
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  ariaLabel?: string;
  /** Shown while empty — New Job's is Workiz's "Description". */
  placeholder?: string;
  className?: string;
}) {
  const editor = useEditor({
    editable,
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        blockquote: false,
        codeBlock: false,
        code: false,
        horizontalRule: false,
        link: false,
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: noteToHtml(value),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        // A contenteditable has no role of its own; this one is a text box.
        role: "textbox",
        "aria-multiline": "true",
        class:
          "min-h-[140px] max-h-[400px] resize-y overflow-y-auto px-2.5 py-2 text-[14px] leading-[1.5] text-[#1a2b30] focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // A note replaced from outside (a refetch, a discard) must land in the box,
  // but typing must not be echoed back into it mid-keystroke.
  useEffect(() => {
    if (!editor) return;
    const next = noteToHtml(value);
    const current = editor.getHTML();
    // An empty note is "" outside and "<p></p>" inside: the same thing, and
    // re-setting it would leave an Undo step on a box nobody typed in.
    const same = next === current || (!next && editor.isEmpty);
    if (!same) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div
      data-slot="wz-note-editor"
      className={cn(
        // MarkdownEditor-module__editor: #9ea6aa edge, #566d76 while focused.
        "box-border w-full overflow-hidden rounded-[4px] border border-wz-outline bg-white focus-within:border-[#566d76]",
        className,
      )}
    >
      {editable ? (
        // ToolbarPlugin-module__toolbar: #f3f6f7 over a #dfe2e3 rule, 4px 8px, 2px gaps.
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 overflow-x-auto border-b border-[#dfe2e3] bg-[#f3f6f7] px-2 py-1">
          <select
            aria-label="Text style"
            className="w-[85px] cursor-pointer appearance-none rounded-[4px] border border-transparent bg-transparent px-2 py-1 text-[13px] leading-[19px] font-medium text-[#1a2b30] transition-colors hover:bg-[#e4ebed] focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wz-link"
            value={editor.isActive("heading", { level: 1 }) ? "1" : editor.isActive("heading", { level: 2 }) ? "2" : "p"}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "p") editor.chain().focus().setParagraph().run();
              else editor.chain().focus().toggleHeading({ level: Number(v) as 1 | 2 }).run();
            }}
          >
            <option value="p">Normal</option>
            <option value="1">Heading</option>
            <option value="2">Subheading</option>
          </select>

          <Divider />
          <Btn label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            <Undo2 />
          </Btn>
          <Btn label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <Redo2 />
          </Btn>

          <Divider />
          <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <BoldIcon strokeWidth={2.5} />
          </Btn>
          <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <ItalicIcon strokeWidth={2.5} />
          </Btn>

          <Divider />
          <Btn
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List />
          </Btn>
          <Btn
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </Btn>

          <Divider />
          <Btn
            label="Link"
            active={editor.isActive("link")}
            onClick={() => {
              const href = window.prompt("Link", editor.getAttributes("link").href ?? "https://");
              if (href === null) return;
              if (!href.trim()) {
                editor.chain().focus().unsetLink().run();
                return;
              }
              editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
            }}
          >
            <LinkIcon />
          </Btn>
        </div>
      ) : null}

      <EditorContent
        editor={editor}
        className={cn(
          // MarkdownEditor-module: paragraphs .4em apart, lists 1.4em in,
          // links #06c, the placeholder #9ea6aa where the text would start.
          "[&_.ProseMirror_p]:mb-[0.4em] [&_.ProseMirror_p:last-child]:mb-0",
          "[&_.ProseMirror_h1]:mt-[0.5em] [&_.ProseMirror_h1]:mb-[0.25em] [&_.ProseMirror_h1]:text-[1.3em] [&_.ProseMirror_h1]:leading-[1.3] [&_.ProseMirror_h1]:font-semibold",
          "[&_.ProseMirror_h2]:mt-[0.5em] [&_.ProseMirror_h2]:mb-[0.25em] [&_.ProseMirror_h2]:text-[1.1em] [&_.ProseMirror_h2]:leading-[1.3] [&_.ProseMirror_h2]:font-semibold",
          "[&_.ProseMirror_strong]:font-semibold [&_.ProseMirror_a]:text-[#0066cc] [&_.ProseMirror_a]:no-underline [&_.ProseMirror_a:hover]:underline",
          "[&_.ProseMirror_ol]:mb-[0.6em] [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-[1.4em] [&_.ProseMirror_ul]:mb-[0.6em] [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-[1.4em] [&_.ProseMirror_li]:mb-0.5",
          "[&_.ProseMirror_p.is-editor-empty:first-child]:before:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child]:before:float-left [&_.ProseMirror_p.is-editor-empty:first-child]:before:h-0 [&_.ProseMirror_p.is-editor-empty:first-child]:before:text-wz-outline [&_.ProseMirror_p.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
        )}
      />
    </div>
  );
}

/** ToolbarPlugin-module__divider: 1px x 20px #9ea6aa, 4px either side. */
function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-wz-outline" />;
}

function Btn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        // ToolbarPlugin-module__btn: 5px round an 18px glyph -> 28x32.
        "flex h-8 w-7 items-center justify-center rounded-[4px] p-[5px] transition-colors [&_svg]:size-[18px]",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-wz-link disabled:cursor-not-allowed disabled:opacity-30",
        active ? "bg-wz-link text-white hover:bg-[#5596df]" : "text-[#566d76] hover:bg-[#e4ebed] hover:text-[#1a2b30]",
      )}
    >
      {children}
    </button>
  );
}
