"use client";

import { useEffect, useRef, useState } from "react";
import type { Deal } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useUpdateDeal } from "../../hooks";
import { JobNoteEditor } from "../job-note-editor";
import { QvButtons, QvIconButton, QvTitle } from "./parts";

/** Six lines of 16px (quickview_wz_open: the text clipped at 96px, then "Show more"). */
const CLAMP_PX = 96;

/**
 * Workiz's Description (quickview_wz_open / _edit_description): the title with
 * its pencil, the job's description under it — clipped to six lines with
 * "Show more" — and, behind the pencil, the rich-text editor with Cancel / Save.
 */
export function DescriptionBlock({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const notes = deal.notes ?? "";

  useEffect(() => {
    const el = textRef.current;
    if (!el || draft !== null) return;
    setOverflows(el.scrollHeight > CLAMP_PX + 1);
  }, [notes, draft]);

  const save = () => {
    if (draft === null) return;
    update.mutate({ notes: draft }, { onSuccess: () => setDraft(null) });
  };

  return (
    <section aria-label="Description" className="border-b border-[#e5e7eb] px-6 pt-6 pb-[18px]">
      <div className="flex items-center gap-2">
        <QvTitle>Description</QvTitle>
        {canEdit ? <QvIconButton label="Edit description" icon="pencil" active={draft !== null} onClick={() => setDraft(draft === null ? notes : null)} /> : null}
      </div>
      {draft !== null ? (
        <div className="mt-2">
          <JobNoteEditor value={draft} onChange={setDraft} editable ariaLabel="Description" placeholder="Description" />
          <QvButtons className="mt-3" onCancel={() => setDraft(null)} onSave={save} saving={update.isPending} />
        </div>
      ) : notes ? (
        <>
          <div
            ref={textRef}
            className={cn("mt-2 overflow-hidden text-[14px] leading-4 text-[#404040]", !expanded && "max-h-24")}
          >
            <JobNoteEditor value={notes} onChange={() => {}} editable={false} ariaLabel="Description" />
          </div>
          {overflows ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 h-8 rounded-[2px] text-[14px] leading-8 font-medium tracking-[0.5px] text-[#3b82f6] hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
