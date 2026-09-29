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
  className,
}: {
  value: string;
  onChange: (html: string) => void;
  editable?: boolean;
  ariaLabel?: string;
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
      Placeholder.configure({ placeholder: "What needs doing…" }),
    ],
    content: noteToHtml(value),
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "min-h-32 px-3 py-2 text-sm focus:outline-none",
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getHTML()),
  });

  // A note replaced from outside (a refetch, a discard) must land in the box,
  // but typing must not be echoed back into it mid-keystroke.
  useEffect(() => {
    if (!editor) return;
    const next = noteToHtml(value);
    if (next !== editor.getHTML()) editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) return null;

  return (
    <div className={cn("overflow-hidden rounded-md border bg-background", className)}>
      {editable ? (
        <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 px-1.5 py-1">
          <select
            aria-label="Text style"
            className="mr-1 h-7 rounded bg-transparent px-1 text-xs outline-none"
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
            <Undo2 className="size-3.5" />
          </Btn>
          <Btn label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <Redo2 className="size-3.5" />
          </Btn>

          <Divider />
          <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <BoldIcon className="size-3.5" />
          </Btn>
          <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <ItalicIcon className="size-3.5" />
          </Btn>

          <Divider />
          <Btn
            label="Bullet list"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List className="size-3.5" />
          </Btn>
          <Btn
            label="Numbered list"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="size-3.5" />
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
            <LinkIcon className="size-3.5" />
          </Btn>
        </div>
      ) : null}

      <EditorContent
        editor={editor}
        className="[&_.ProseMirror]:min-h-32 [&_.ProseMirror_a]:underline [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-5 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-5"
      />
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-border" />;
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
        "grid size-7 place-items-center rounded transition-colors",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/60",
        disabled && "opacity-40",
      )}
    >
      {children}
    </button>
  );
}
