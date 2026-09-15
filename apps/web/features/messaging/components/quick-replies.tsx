"use client";

import type { MessageTemplate } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useTemplates } from "../hooks";
import { TemplatePicker } from "./template-picker";

/**
 * The row above the Workiz composer: the templates as outlined chips that
 * scroll sideways, and the "More replies" pill that opens the searchable
 * list. Picking either renders the template into the composer.
 */
export function QuickReplies({
  channel,
  onPick,
  disabled,
  pending,
  className,
}: {
  channel: "sms" | "email";
  onPick: (template: MessageTemplate) => void;
  disabled?: boolean;
  pending?: boolean;
  className?: string;
}) {
  const { data: templates } = useTemplates({ channel });
  const list = templates ?? [];
  if (list.length === 0) return null;

  return (
    <div className={cn("flex items-center gap-3 border-t bg-background px-4 py-2.5", className)} data-testid="quick-replies">
      <div
        className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Quick replies"
      >
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled || pending}
            onClick={() => onPick(t)}
            title={t.messageTemplateTitle}
            className="shrink-0 rounded-md border border-brand/50 bg-background px-3 py-1.5 text-[13px] font-medium text-brand transition-colors hover:bg-brand/5 disabled:opacity-50"
          >
            {t.messageTemplateTitle}
          </button>
        ))}
      </div>
      <TemplatePicker channel={channel} onPick={onPick} disabled={disabled} pending={pending} />
    </div>
  );
}
