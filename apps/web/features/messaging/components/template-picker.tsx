"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { MessageTemplate } from "@bitcrm/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useTemplates } from "../hooks";

/**
 * Workiz's "More replies" pill at the right end of the quick-replies row:
 * a searchable list of every canned message usable on this channel,
 * grouped by category. Picking one hands the template up; the composer
 * renders it against the thread.
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
  const { data: templates, isLoading } = useTemplates({ channel }, open);

  const groups = new Map<string, MessageTemplate[]>();
  for (const t of templates ?? []) {
    const key = t.category?.trim() || "Templates";
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        disabled={disabled || pending}
        aria-expanded={open}
        aria-label="More replies"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-chip border border-foreground/60 bg-background px-4 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        More replies
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute bottom-full right-0 z-20 mb-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-md"
            data-testid="template-picker"
          >
            <Command loop>
              <CommandInput autoFocus placeholder="Search templates…" className="h-9" />
              <CommandList className="max-h-64">
                <CommandEmpty>{isLoading ? "Loading…" : "No template matches."}</CommandEmpty>
                {[...groups.entries()].map(([group, items]) => (
                  <CommandGroup key={group} heading={group}>
                    {items.map((t) => (
                      <CommandItem
                        key={t.id}
                        value={`${t.messageTemplateTitle} ${t.category ?? ""}`}
                        onSelect={() => {
                          setOpen(false);
                          onPick(t);
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium">
                            {t.messageTemplateTitle}
                            {t.isDefault ? (
                              <span className="ml-1.5 rounded-sm bg-muted px-1 text-[10px] uppercase text-muted-foreground">
                                default
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {t.messageTemplate.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
                          </span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </div>
        </>
      ) : null}
    </span>
  );
}
