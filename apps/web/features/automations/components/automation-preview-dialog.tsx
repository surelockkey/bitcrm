"use client";

import type { AutomationAction, AutomationRule } from "@bitcrm/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { messageSegments } from "../lib";

const KIND: Partial<Record<AutomationAction["type"], string>> = {
  send_sms: "Text template",
  send_email: "Email template",
  send_in_app: "In-app template",
};

/** The actions of a rule that carry a message — what Workiz's Preview shows. */
export function previewableMessages(rule: AutomationRule): AutomationAction[] {
  return (rule.spec?.actions ?? []).filter((a) => KIND[a.type] && (a.body?.trim() || a.subject?.trim()));
}

/**
 * Workiz's "Preview" from a rule card's menu (pg_automations_wz_30_preview):
 * a 698px modal, 16px corners, 24px in; a "TEXT TEMPLATE" chip (12px/18px
 * #3acf7d on #ebfaf2, 4px corners, 5px in) and the message under it as the
 * rich-text editor shows it (14px/16px #404040, 20px in), short codes as the
 * editor's `{…} first_name` chips. Read-only — Edit is where it changes.
 */
export function AutomationPreviewDialog({
  rule,
  open,
  onOpenChange,
}: {
  rule: AutomationRule;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const messages = previewableMessages(rule);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] w-[698px] max-w-[calc(100vw-32px)] gap-0 overflow-y-auto p-6 sm:max-w-[698px]">
        <DialogTitle className="sr-only">Preview of {rule.name}</DialogTitle>
        <div className="flex flex-col gap-6">
          {messages.map((action, i) => (
            <section key={i} className="flex flex-col">
              <span className="w-fit rounded-[4px] bg-[#ebfaf2] px-[5px] text-xs leading-[18px] tracking-[0.4px] text-wz-tag-success uppercase">
                {KIND[action.type]}
              </span>
              {action.type === "send_email" && action.subject ? (
                <p className="mt-4 px-5 text-sm leading-4 font-semibold tracking-[0.4px] text-wz-strong">
                  {action.subject}
                </p>
              ) : null}
              <p className="mt-7 px-5 text-sm leading-[22px] tracking-[0.4px] whitespace-pre-wrap text-wz-strong">
                {messageSegments(action.body ?? "").map((segment, j) =>
                  segment.type === "code" ? (
                    <span key={j} className="mx-0.5 rounded-[4px] bg-wz-secondary-hover px-1.5 py-0.5">
                      {"{…}"} {segment.code}
                    </span>
                  ) : (
                    <span key={j}>{segment.text}</span>
                  ),
                )}
              </p>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
