"use client";

import type { MessageTemplate } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useTemplates } from "../hooks";
import { TemplatePicker } from "./template-picker";

/**
 * The row above the Workiz composer (`messaging-module__replies`,
 * pg_messages_wz_07_thread_client): a 48px white strip; the templates as
 * 32px chips — 13px/16px 500 #6aa8ee in a 1px #6aa8ee outline, r4, 8px apart,
 * scrolling sideways from 16px in — and the "More replies" secondary pill 16px
 * from the right, which opens the searchable list. Picking either renders
 * the template into the composer.
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
    <div className={cn("relative flex h-12 shrink-0 items-center bg-background", className)} data-testid="quick-replies">
      <div
        className="mx-4 my-2 flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Quick replies"
      >
        {list.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled || pending}
            onClick={() => onPick(t)}
            title={t.messageTemplateTitle}
            className="flex h-8 flex-none items-center rounded-[4px] border border-wz-link px-3 py-2 text-[13px] leading-4 font-medium whitespace-nowrap text-wz-link transition-colors hover:bg-wz-secondary-hover disabled:opacity-50"
          >
            {t.messageTemplateTitle}
          </button>
        ))}
      </div>
      <TemplatePicker channel={channel} onPick={onPick} disabled={disabled} pending={pending} />
    </div>
  );
}
