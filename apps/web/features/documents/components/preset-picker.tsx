"use client";

import { useMemo } from "react";
import { Check } from "lucide-react";
import type { DocumentTemplateKind } from "@bitcrm/types";
import { DOCUMENT_PRESETS, createTemplateContent, type DocumentPresetId } from "@bitcrm/document-renderer";
import { cn } from "@/lib/utils";
import { useBusinessProfile, useSampleContext } from "../hooks";
import { DocumentThumbnail } from "./document-thumbnail";

const NO_ASSETS: Record<string, string> = {};

/** The three starting layouts as selectable thumbnails (radio group). */
export function PresetPicker({
  kind,
  value,
  onChange,
  columns = 3,
  label = "Layout",
}: {
  kind: DocumentTemplateKind;
  value: DocumentPresetId | undefined;
  onChange: (id: DocumentPresetId) => void;
  columns?: 1 | 3;
  label?: string;
}) {
  const { data: profile } = useBusinessProfile();
  const ctx = useSampleContext(kind, profile, NO_ASSETS);
  const contents = useMemo(
    () => Object.fromEntries(DOCUMENT_PRESETS.map((p) => [p.id, createTemplateContent(kind, p.id)])),
    [kind],
  );

  return (
    <div role="radiogroup" aria-label={label} className={cn("grid gap-3", columns === 3 ? "grid-cols-3" : "grid-cols-1")}>
      {DOCUMENT_PRESETS.map((p) => {
        const selected = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${p.name}: ${p.description}`}
            onClick={() => onChange(p.id)}
            className={cn(
              "group relative flex flex-col gap-1.5 rounded-lg border p-2 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
              selected ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/60",
              columns === 1 && "flex-row items-center",
            )}
          >
            <div className={cn("overflow-hidden rounded-sm ring-1 ring-black/10", columns === 1 ? "w-20 flex-none" : "w-full")}>
              <DocumentThumbnail content={contents[p.id]} ctx={ctx} title={`${p.name} preset`} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium">{p.name}</div>
              {columns === 1 ? <p className="line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p> : null}
            </div>
            {selected ? (
              <span className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground">
                <Check className="size-3" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
