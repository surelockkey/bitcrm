"use client";

import { useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Braces,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Plus,
  Underline,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { mergeTagsForKind } from "../../lib";
import { useEditorStore } from "../store";
import { getBlock } from "../tree";
import { useEditorUi, type Zoom } from "../ui-store";
import { ALIGN_OPTIONS } from "./controls";

const EMPTY_STATE = {
  bold: false,
  italic: false,
  underline: false,
  bullet: false,
  ordered: false,
  link: false,
  color: "",
  style: "p",
};

function TB({ label, active, disabled, onClick, children }: { label: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      // Keep the editor focused and its selection intact.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(active && "bg-muted text-foreground")}
    >
      {children}
    </Button>
  );
}

function LinkButton({ editor, active }: { editor: Editor | null; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const apply = () => {
    if (!editor) return;
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!url) chain.unsetLink().run();
    else chain.setLink({ href: /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}` }).run();
    setOpen(false);
  };
  if (active) {
    return (
      <TB label="Remove link" active disabled={!editor} onClick={() => editor?.chain().focus().extendMarkRange("link").unsetLink().run()}>
        <Link2Off />
      </TB>
    );
  }
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setHref(String(editor?.getAttributes("link").href ?? ""));
      }}
    >
      <DropdownMenuTrigger asChild disabled={!editor}>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Add link" title="Add link" onMouseDown={(e) => e.preventDefault()}>
          <Link2 />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <Input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="https://example.com or mailto:"
            aria-label="Link URL"
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm">
            Apply
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function InsertValue({ editor }: { editor: Editor | null }) {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const groups = mergeTagsForKind(kind, "");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!editor}>
        <Button type="button" variant="ghost" size="sm" className="gap-1" onMouseDown={(e) => e.preventDefault()}>
          <Braces /> Insert value
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
        <DropdownMenuLabel className="text-xs">Insert a value</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {groups.map((g) => (
          <DropdownMenuSub key={g.id}>
            <DropdownMenuSubTrigger className="text-xs">{g.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-56 overflow-y-auto">
              {g.tags.map((t) => (
                <DropdownMenuItem key={t.path} onSelect={() => editor?.chain().focus().insertMergeTag(t.path).run()} className="flex-col items-start gap-0">
                  <span className="text-xs">{t.label}</span>
                  <span className="text-[10px] text-muted-foreground">{t.sample}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ZOOMS: { value: string; label: string }[] = [
  { value: "fit", label: "Fit" },
  { value: "0.5", label: "50%" },
  { value: "0.75", label: "75%" },
  { value: "1", label: "100%" },
  { value: "1.25", label: "125%" },
];

/**
 * Formatting for the active text editor + alignment/size for the selected
 * block. Always rendered (disabled when idle) so the canvas never shifts.
 */
export function TextToolbar() {
  const editor = useEditorUi((s) => s.textEditor);
  const zoom = useEditorUi((s) => s.zoom);
  const selectedBlock = useEditorStore((s) =>
    s.selection?.type === "block" && s.draft ? getBlock(s.draft.content, s.selection.id) : null,
  );

  const state =
    useEditorState({
      editor,
      selector: ({ editor: e }) => {
        if (!e || e.isDestroyed) return EMPTY_STATE;
        return {
          bold: e.isActive("bold"),
          italic: e.isActive("italic"),
          underline: e.isActive("underline"),
          bullet: e.isActive("bulletList"),
          ordered: e.isActive("orderedList"),
          link: e.isActive("link"),
          color: String(e.getAttributes("textStyle").color ?? ""),
          style: e.isActive("heading", { level: 1 })
            ? "h1"
            : e.isActive("heading", { level: 2 })
              ? "h2"
              : e.isActive("heading", { level: 3 })
                ? "h3"
                : "p",
        };
      },
    }) ?? EMPTY_STATE;

  const on = !!editor;
  const chain = () => editor!.chain().focus();
  const align = selectedBlock?.style?.align ?? "left";
  const fontSize = selectedBlock?.style?.fontSize;
  const setBlockStyle = (patch: Record<string, unknown>) =>
    selectedBlock && useEditorStore.getState().updateBlock(selectedBlock.id, { style: patch }, { coalesce: `toolbar:${selectedBlock.id}` });

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="flex h-11 flex-none items-center gap-0.5 overflow-x-auto border-b bg-background px-2 [&_svg]:size-4"
    >
      <Select
        value={state.style}
        disabled={!on}
        onValueChange={(v) => {
          if (!editor || !v) return;
          if (v === "p") chain().setParagraph().run();
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run();
        }}
      >
        <SelectTrigger size="sm" className="w-28 text-xs" aria-label="Text style" onMouseDown={(e) => e.preventDefault()}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent onCloseAutoFocus={(e) => { e.preventDefault(); editor?.commands.focus(); }}>
          <SelectItem value="p">Paragraph</SelectItem>
          <SelectItem value="h1">Heading 1</SelectItem>
          <SelectItem value="h2">Heading 2</SelectItem>
          <SelectItem value="h3">Heading 3</SelectItem>
        </SelectContent>
      </Select>
      <div className="mx-1 h-5 w-px bg-border" />
      <TB label="Bold" active={state.bold} disabled={!on} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </TB>
      <TB label="Italic" active={state.italic} disabled={!on} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </TB>
      <TB label="Underline" active={state.underline} disabled={!on} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </TB>
      <label
        className={cn("relative flex size-7 items-center justify-center rounded-md hover:bg-muted", !on && "pointer-events-none opacity-50")}
        title="Text color"
        onMouseDown={(e) => e.preventDefault()}
      >
        <span className="text-sm font-semibold underline decoration-[3px] underline-offset-2" style={{ textDecorationColor: state.color || "currentColor" }}>
          A
        </span>
        <input
          type="color"
          aria-label="Text color"
          disabled={!on}
          value={/^#[0-9a-f]{6}$/i.test(state.color) ? state.color : "#000000"}
          onChange={(e) => editor?.chain().setColor(e.target.value).run()}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {state.color ? (
        <Button type="button" variant="ghost" size="xs" disabled={!on} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().unsetColor().run()}>
          Reset color
        </Button>
      ) : null}
      <LinkButton editor={editor} active={state.link} />
      <div className="mx-1 h-5 w-px bg-border" />
      <TB label="Bulleted list" active={state.bullet} disabled={!on} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </TB>
      <TB label="Numbered list" active={state.ordered} disabled={!on} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </TB>
      <div className="mx-1 h-5 w-px bg-border" />
      {ALIGN_OPTIONS.map((o) => (
        <TB key={o.value} label={o.label} active={!!selectedBlock && align === o.value} disabled={!selectedBlock} onClick={() => setBlockStyle({ align: o.value })}>
          {o.icon}
        </TB>
      ))}
      <TB label="Smaller text" disabled={!selectedBlock} onClick={() => setBlockStyle({ fontSize: Math.max(6, (fontSize ?? 12) - 1) })}>
        <Minus />
      </TB>
      <span className="w-8 text-center text-[11px] text-muted-foreground tabular-nums">{fontSize ? `${fontSize}px` : "—"}</span>
      <TB label="Larger text" disabled={!selectedBlock} onClick={() => setBlockStyle({ fontSize: Math.min(96, (fontSize ?? 12) + 1) })}>
        <Plus />
      </TB>
      <div className="mx-1 h-5 w-px bg-border" />
      <InsertValue editor={editor} />
      <div className="ml-auto flex items-center gap-1 pl-2">
        <Select value={String(zoom)} onValueChange={(v) => v && useEditorUi.getState().setZoom((v === "fit" ? "fit" : Number(v)) as Zoom)}>
          <SelectTrigger size="sm" className="w-20 text-xs" aria-label="Zoom">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {ZOOMS.map((z) => (
              <SelectItem key={z.value} value={z.value}>
                {z.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
