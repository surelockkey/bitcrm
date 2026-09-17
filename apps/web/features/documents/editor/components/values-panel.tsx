"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { mergeTagsForKind } from "../../lib";
import { useEditorStore } from "../store";
import { useEditorUi } from "../ui-store";
import { PanelSection } from "./controls";

/** Inserts a merge tag into the active text editor, or copies `{{path}}`. */
export function insertOrCopyMergeTag(path: string) {
  const editor = useEditorUi.getState().textEditor;
  if (editor && !editor.isDestroyed) {
    editor.chain().focus().insertMergeTag(path).run();
    return;
  }
  const text = `{{${path}}}`;
  navigator.clipboard
    ?.writeText(text)
    .then(() => toast.success(`Copied ${text}`, { description: "Select a text block to insert values directly." }))
    .catch(() => toast.info(text));
}

export function ValuesPanel() {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const hasEditor = useEditorUi((s) => !!s.textEditor);
  const [query, setQuery] = useState("");
  const groups = useMemo(() => mergeTagsForKind(kind, query), [kind, query]);

  return (
    <PanelSection title="Values">
      <p className="text-xs text-muted-foreground">
        {hasEditor ? "Click a value to insert it at the cursor." : "Select a text block to insert values; otherwise a click copies the tag."}
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search values"
          aria-label="Search values"
          className="h-8 pl-7 text-xs"
        />
      </div>
      {groups.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No values match “{query}”.</p> : null}
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.id} className="space-y-1">
            <div className="text-[11px] font-medium text-muted-foreground">{g.label}</div>
            <ul className="space-y-0.5">
              {g.tags.map((t) => (
                <li key={t.path}>
                  <button
                    type="button"
                    // Keep the editor's selection: don't take focus on mousedown.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertOrCopyMergeTag(t.path)}
                    className="flex w-full flex-col items-start rounded-md px-2 py-1 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    title={`{{${t.path}}}`}
                  >
                    <span className="text-xs font-medium">{t.label}</span>
                    <span className="w-full truncate text-[11px] text-muted-foreground">{t.sample}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </PanelSection>
  );
}
