"use client";

import { useState } from "react";
import { ArrowLeft, Eye, Loader2, Pencil, Redo2, Save, Star, Undo2 } from "lucide-react";
import type { DocumentRenderContext } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { KIND_LABELS } from "../../lib";
import { templateNameSchema } from "../../schemas";
import { selectCanRedo, selectCanUndo, selectIsDirty, useEditorStore } from "../store";
import { useEditorUi, type EditorMode } from "../ui-store";
import { Segmented } from "./controls";
import { PreviewDialog, PreviewSourcePicker } from "./preview";

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
        <Input
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
          className="h-8 w-64 max-w-full text-sm font-semibold"
        />
        {error ? <p className="absolute top-full left-0 mt-1 rounded bg-destructive px-1.5 py-0.5 text-[11px] text-white">{error}</p> : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(name)}
      className="group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left hover:bg-muted disabled:hover:bg-transparent"
      aria-label={`Rename template ${name}`}
    >
      <span className="truncate text-sm font-semibold">{name}</span>
      {editable ? <Pencil className="size-3.5 flex-none text-muted-foreground opacity-0 group-hover:opacity-100" /> : null}
    </button>
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

export function EditorTopBar({
  canEdit,
  compact,
  isDefault,
  saving,
  ctx,
  onBack,
  onSave,
}: {
  canEdit: boolean;
  /** Narrow / read-only layout: no undo, no Edit/Preview toggle. */
  compact: boolean;
  isDefault: boolean;
  saving: boolean;
  ctx: DocumentRenderContext;
  onBack: () => void;
  onSave: () => void;
}) {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const dirty = useEditorStore(selectIsDirty);
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);
  const mode = useEditorUi((s) => s.mode);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
  const mod = isMac ? "⌘" : "Ctrl+";

  return (
    <header className="flex h-14 flex-none items-center gap-2 border-b bg-background px-2 sm:px-3">
      <Button variant="ghost" size="icon-sm" aria-label="Back to templates" onClick={onBack}>
        <ArrowLeft />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <InlineName editable={canEdit} />
        <Badge variant="outline" className="hidden flex-none sm:inline-flex">
          {KIND_LABELS[kind].singular}
        </Badge>
        {isDefault ? (
          <Badge variant="secondary" className="hidden flex-none gap-1 md:inline-flex">
            <Star className="size-3" /> Default
          </Badge>
        ) : null}
        <span
          className={cn("hidden flex-none text-xs lg:inline", dirty ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}
          aria-live="polite"
        >
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
      </div>

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
          <div className="w-40">
            <Segmented<EditorMode>
              label="Editor mode"
              value={mode}
              onChange={(m) => useEditorUi.getState().setMode(m)}
              options={[
                { value: "edit", label: "Edit" },
                { value: "preview", label: "Preview" },
              ]}
            />
          </div>
        </>
      ) : null}
      <div className="hidden md:block">
        <PreviewSourcePicker />
      </div>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPreviewOpen(true)}>
        <Eye /> <span className="hidden sm:inline">Preview</span>
      </Button>
      {canEdit ? (
        <Button variant="brand" size="sm" className="gap-1.5" disabled={!dirty || saving} onClick={onSave} title={`Save (${mod}S)`}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      ) : null}
      <PreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} ctx={ctx} />
    </header>
  );
}
