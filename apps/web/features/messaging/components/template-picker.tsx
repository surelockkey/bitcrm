"use client";

import { useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import type { MessageTemplate } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
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
 * "Templates" in the composer: a searchable list of the canned messages
 * usable on this channel, grouped by their category. Picking one hands
 * the template up; the composer renders it against the thread.
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
    <span className="relative inline-flex">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        disabled={disabled || pending}
        aria-expanded={open}
        aria-label="Insert a template"
        onClick={() => setOpen((o) => !o)}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
        Templates
      </Button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-md">
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
