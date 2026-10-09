"use client";

import { useState } from "react";
import { Eye, Redo2, Save, Undo2 } from "lucide-react";
import type { DocumentRenderContext } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WzButton } from "@/components/workiz/button";
import { cn } from "@/lib/utils";
import { KIND_LABELS } from "../../lib";
import { templateNameSchema } from "../../schemas";
import { selectCanRedo, selectCanUndo, selectIsDirty, useEditorStore } from "../store";
import { useEditorUi, type EditorMode } from "../ui-store";
import { PreviewDialog, PreviewSourcePicker } from "./preview";

/**
 * The template's name as Workiz heads its editor: `h4._title` 16px/19px 600
 * #404040 (pg_settings_general_wz_doc_invoice). A click opens it in a box to
 * rename (Workiz's custom documents show a "Document name" field there).
 */
function InlineName({ editable }: { editable: boolean }) {
  const name = useEditorStore((s) => s.draft?.name ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    if (editing === null) return;
    const parsed = templateNameSchema.safeParse(editing);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid name");
      return;
    }
    useEditorStore.getState().rename(parsed.data);
    setEditing(null);
    setError(null);
  };

  if (editing !== null) {
    return (
      <div className="relative min-w-0">
        <input
          autoFocus
          aria-label="Template name"
          aria-invalid={!!error}
          value={editing}
          maxLength={120}
          onChange={(e) => {
            setEditing(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setEditing(null);
              setError(null);
            }
          }}
          // The outlined box of Workiz's "Document name" (Input-module: 40px, #9ea6aa, #6aa8ee focused).
          className="-my-2.5 block h-10 w-[420px] max-w-full rounded-[4px] border border-wz-outline bg-white px-3 text-[13px] leading-4 tracking-[0.4px] text-foreground outline-none focus:border-wz-link aria-invalid:border-wz-error"
        />
        {error ? <p className="absolute top-full left-0 mt-3 text-xs leading-[10px] text-wz-error">{error}</p> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(name)}
      className="min-w-0 truncate text-left text-base leading-[19px] font-semibold tracking-[0.4px] text-wz-strong outline-none enabled:cursor-text enabled:hover:underline focus-visible:underline"
      aria-label={`Rename template ${name}`}
      title={editable ? "Rename" : undefined}
    >
      {name}
    </button>
  );
}

/** Workiz's small chip beside a name (11px 600 ink on #dfe2e3, the tab counter's). */
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 flex-none items-center rounded-[10px] bg-border px-2 text-[11px] leading-4 font-semibold text-foreground">
      {children}
    </span>
  );
}

function IconAction({ label, shortcut, onClick, disabled, children }: { label: string; shortcut?: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} disabled={disabled}>
            {children}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {shortcut ? <span className="ml-1.5 opacity-60">{shortcut}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Edit | Preview of the page, in Workiz's segmented box (the Files panel's
 * All | Media): #f3f6f7, the chosen part white with a soft shadow, 14px 600
 * #6aa8ee. Radios: the page is one or the other.
 */
function ModeSwitch() {
  const mode = useEditorUi((s) => s.mode);
  const options: { value: EditorMode; label: string }[] = [
    { value: "edit", label: "Edit" },
    { value: "preview", label: "Preview" },
  ];
  return (
    <div role="radiogroup" aria-label="Editor mode" className="flex h-[34px] rounded-[4px] bg-wz-secondary-hover p-0.5">
      {options.map((o) => {
        const on = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => useEditorUi.getState().setMode(o.value)}
            className={cn(
              "min-w-[72px] cursor-pointer rounded-[2px] px-4 leading-[19px] tracking-[0.4px] outline-none focus-visible:underline",
              on ? "bg-white text-sm font-semibold text-wz-link shadow-[0_2px_4px_rgba(59,75,82,0.1)]" : "text-[13px] text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The editor's head, as Workiz's (pg_settings_general_wz_doc_invoice): the
 * name, then a row of yellow regular pills 16px apart — Preview, Save — 15px
 * under it, 20px in. Workiz's "‹ Back" is left out (no back links in page
 * heads: the sidebar and the browser go back), and so are its Settings,
 * Duplicate and Delete template (the grid's row icons do those here). Ours
 * after the pills: undo / redo, Edit | Preview of the page, the data the
 * preview prints, and whether everything is saved.
 */
export function EditorTopBar({
  canEdit,
  compact,
  isDefault,
  saving,
  ctx,
  onSave,
}: {
  canEdit: boolean;
  /** Narrow / read-only layout: no undo, no Edit/Preview toggle. */
  compact: boolean;
  isDefault: boolean;
  saving: boolean;
  ctx: DocumentRenderContext;
  onSave: () => void;
}) {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const dirty = useEditorStore(selectIsDirty);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <header className="flex flex-none flex-col gap-[15px] bg-white px-5 pt-[35px] pb-5">
      <div className="flex min-h-[19px] min-w-0 items-center gap-2">
        <InlineName editable={canEdit} />
        <Chip>{KIND_LABELS[kind].singular}</Chip>
        {isDefault ? <Chip>Default</Chip> : null}
        <span
          className={cn("ml-1 hidden flex-none text-xs leading-4 lg:inline", dirty ? "text-wz-toast-warning" : "text-wz-outline-label")}
          aria-live="polite"
        >
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <WzButton size="regular" icon={<Eye />} onClick={() => setPreviewOpen(true)}>
          Preview
        </WzButton>
        {canEdit ? (
          <WzButton
            size="regular"
            icon={<Save />}
            loading={saving}
            disabled={!dirty}
            onClick={onSave}
            title={`Save (${mod}S)`}
            // Workiz's held button: #eff1f1 with #9ea6aa words.
            className="disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline"
          >
            Save
          </WzButton>
        ) : null}
        {!compact ? (
          <>
            <div className="flex items-center">
              <IconAction label="Undo" shortcut={`${mod}Z`} disabled={!canUndo} onClick={() => useEditorStore.getState().undo()}>
                <Undo2 />
              </IconAction>
              <IconAction label="Redo" shortcut={isMac ? "⇧⌘Z" : "Ctrl+Y"} disabled={!canRedo} onClick={() => useEditorStore.getState().redo()}>
                <Redo2 />
              </IconAction>
            </div>
            <ModeSwitch />
          </>
        ) : null}
        <div className="hidden md:block">
          <PreviewSourcePicker />
        </div>
      </div>
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} ctx={ctx} />
    </header>
  );
}
