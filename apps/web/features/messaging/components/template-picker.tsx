"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { MessageTemplate } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { useMessagingAccess, useTemplates } from "../hooks";
import { WzSearchIcon } from "./inbox-icons";
import { TemplateFormDialog } from "./template-form-dialog";

/** A template's text as the list shows it: the HTML flattened to one run of words. */
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Workiz's "More replies" pill at the right end of the quick-replies row and
 * the "Quick reply" list it opens (pg_messages_wz_09_client_more_replies and
 * `messaging-module__popup` / `quickRepliesPopup-module`): 448×452, r8, a
 * soft shadow, 16px in, hung 16px from the right over the row; "Quick reply"
 * 16px/19px 600; a 47px #f7f7f7 search box with the glass; a 3px #3acf7d rule;
 * then every template usable on this channel, flat — the title 13px/16px 600
 * over its text in #768287, 24px above each, dashed rules between; and
 * "+ New template" pinned to the foot for whoever may create one. Picking one
 * hands it up; the composer renders it against the thread.
 */
export function TemplatePicker({
  channel,
  onPick,
  disabled,
  pending,
}: {
  channel: "sms" | "email";
  onPick: (template: MessageTemplate) => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const { canCreateTemplates } = useMessagingAccess();
  const { data: templates, isLoading } = useTemplates({ channel }, open);

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (templates ?? [])
      .map((t) => ({ t, text: plain(t.messageTemplate) }))
      .filter(({ t, text }) => !q || t.messageTemplateTitle.toLowerCase().includes(q) || text.toLowerCase().includes(q));
  }, [templates, query]);

  return (
    <span className="relative mr-4 inline-flex shrink-0">
      <Button
        type="button"
        variant="outline"
        disabled={disabled || pending}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className="gap-0 px-3"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        <span className="px-1">More replies</span>
      </Button>

      {open ? (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-10 cursor-default" onClick={close} />
          <div
            className="absolute bottom-[calc(100%+8px)] right-0 z-20 flex h-[452px] w-[448px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[8px] bg-background shadow-[10px_0_30px_rgba(0,0,0,0.1)]"
            data-testid="template-picker"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                close();
              }
            }}
          >
            <div className="shrink-0 px-4 pt-4">
              <h4 className="text-[16px] leading-[19px] font-semibold text-foreground">Quick reply</h4>
              <label className="mt-[15px] flex h-[47px] items-center gap-3 rounded-[8px] bg-muted px-[13px] py-2.5">
                <WzSearchIcon size={20} className="shrink-0 text-foreground" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search..."
                  aria-label="Search templates"
                  className="h-[27px] min-w-0 flex-1 bg-transparent px-0.5 text-[16px] leading-4 text-[#3b4c53] outline-none placeholder:text-wz-text"
                />
              </label>
              <hr className="mt-[13px] border-0 border-t-[3px] border-[#3acf7d]" />
            </div>

            <div className={canCreateTemplates ? "min-h-0 flex-1 overflow-y-auto px-4 pb-11" : "min-h-0 flex-1 overflow-y-auto px-4 pb-4"}>
              {isLoading ? (
                <p className="pt-6 text-[13px] leading-4 text-wz-outline-label">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="pt-6 text-[13px] leading-4 text-wz-outline-label">No template matches.</p>
              ) : (
                rows.map(({ t, text }) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      close();
                      onPick(t);
                    }}
                    className="block w-full border-b border-dashed border-[rgba(59,75,82,0.2)] pb-4 pt-6 text-left outline-none hover:bg-wz-secondary-hover focus-visible:bg-wz-secondary-hover"
                  >
                    <span className="block truncate text-[13px] leading-4 font-semibold text-foreground">
                      {t.messageTemplateTitle}
                    </span>
                    <span className="mt-1 block text-[13px] leading-4 text-wz-outline-label">{text}</span>
                  </button>
                ))
              )}
            </div>

            {canCreateTemplates ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  setCreating(true);
                }}
                className="absolute bottom-0 flex h-11 w-full items-center bg-background py-1.5 pl-4 text-[13px] leading-4 font-bold text-foreground shadow-[0_-4px_8px_rgba(59,75,82,0.05)]"
              >
                <Plus className="mr-[11px] size-[22px]" strokeWidth={2} />
                New template
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {canCreateTemplates && creating ? <TemplateFormDialog open onOpenChange={setCreating} /> : null}
    </span>
  );
}
