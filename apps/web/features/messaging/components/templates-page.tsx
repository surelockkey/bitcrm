"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import type { MessageTemplate } from "@bitcrm/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzInfoTip } from "@/components/workiz/form-section-title";
import { WzEditIcon, WzTrashIcon } from "@/components/workiz/icons";
import { WzRowIconButton, WzTag } from "@/components/workiz/phone-tab-parts";
import { cn } from "@/lib/utils";
import { useDeleteTemplate, useMessagingAccess, useTemplates, useUpdateTemplate } from "../hooks";
import { templateSnippet } from "../template-text";
import { TemplateFormDialog } from "./template-form-dialog";

const CHANNEL_LABEL: Record<MessageTemplate["channel"], string> = {
  sms: "SMS",
  email: "Email",
  any: "SMS + email",
};

/** Active first, then by title — the order the composer offers them in. */
export function sortTemplates(templates: readonly MessageTemplate[]): MessageTemplate[] {
  return [...templates].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.messageTemplateTitle.localeCompare(b.messageTemplateTitle),
  );
}

/**
 * Our message templates — Workiz's quick replies (the inbox's "Quick reply"
 * list, pg_messages_wz_09_client_more_replies: each a 13px/16px 600 ink
 * title over its 13px #768287 text, dashed rgba(59,75,82,.2) rules, a
 * "+ New template" foot). Workiz keeps them with its texts' settings, so they
 * sit on the Texting tab under "Text templates"; ours add the row icons
 * (edit, archive / restore, delete) and the marks (Default, channel,
 * category, Archived). Nothing for a reader who may not see templates.
 */
export function MessageTemplatesSection({ className }: { className?: string }) {
  const { canViewTemplates, canCreateTemplates, canEditTemplates, canDeleteTemplates } = useMessagingAccess();
  const { data: templates } = useTemplates({ includeInactive: true }, canViewTemplates);
  const update = useUpdateTemplate();
  const del = useDeleteTemplate();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MessageTemplate | undefined>();
  const [deleting, setDeleting] = useState<MessageTemplate | undefined>();

  if (!canViewTemplates) return null;
  const sorted = sortTemplates(templates ?? []);

  return (
    <section aria-labelledby="quick-replies-title" data-slot="message-templates" className={className}>
      <div className="mb-2 flex items-center">
        <h3 id="quick-replies-title" className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">
          Quick replies
        </h3>
        <WzInfoTip
          label="Quick replies"
          text="The texts the message box offers under More replies; short codes are filled in when one is sent. Archived ones stay readable in history."
        />
      </div>
      <p className="text-[13px] leading-[19px] tracking-[0.4px] text-wz-slate">
        Canned texts your team sends from Messages and the job page, with short codes.
      </p>

      {sorted.length === 0 ? (
        <p className="mt-4 text-[13px] leading-4 text-wz-outline-label">No templates yet. Write the texts your team sends every day, once.</p>
      ) : (
        <ul aria-label="Quick replies" className="mt-2">
          {sorted.map((t) => (
            <li
              key={t.id}
              data-testid={`template-${t.id}`}
              // Workiz's rule between quick replies: 1px dashed rgba(59,75,82,.2).
              className={cn(
                "flex items-start gap-3 border-b border-dashed border-[rgba(59,75,82,0.2)] pt-6 pb-4 last:border-b-0",
                !t.active && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] leading-4 font-semibold tracking-[0.4px] text-foreground">{t.messageTemplateTitle}</span>
                  {t.isDefault ? <WzTag className="text-[11px] leading-[14px]">Default</WzTag> : null}
                  {!t.active ? <WzTag className="bg-wz-outline text-[11px] leading-[14px]">Archived</WzTag> : null}
                  <span className="text-xs leading-4 text-wz-caption">
                    {[CHANNEL_LABEL[t.channel], t.category].filter(Boolean).join(" · ")}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-4 tracking-[0.4px] text-wz-outline-label">
                  {templateSnippet(t.messageTemplate)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 pt-px">
                {canEditTemplates ? (
                  <WzRowIconButton
                    label={`Edit ${t.messageTemplateTitle}`}
                    onClick={() => {
                      setEditing(t);
                      setFormOpen(true);
                    }}
                  >
                    <WzEditIcon size={16} />
                  </WzRowIconButton>
                ) : null}
                {canEditTemplates && !t.active ? (
                  <WzRowIconButton
                    label={`Restore ${t.messageTemplateTitle}`}
                    onClick={() => update.mutate({ id: t.id, body: { active: true } })}
                  >
                    <ArchiveRestore className="size-[17px]" strokeWidth={1.5} />
                  </WzRowIconButton>
                ) : null}
                {canDeleteTemplates && t.active ? (
                  <WzRowIconButton label={`Archive ${t.messageTemplateTitle}`} onClick={() => del.mutate({ id: t.id })}>
                    <Archive className="size-[17px]" strokeWidth={1.5} />
                  </WzRowIconButton>
                ) : null}
                {canDeleteTemplates && !t.active ? (
                  <WzRowIconButton label={`Delete ${t.messageTemplateTitle}`} onClick={() => setDeleting(t)}>
                    <WzTrashIcon size={17} />
                  </WzRowIconButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canCreateTemplates ? (
        <button
          type="button"
          aria-label="New template"
          onClick={() => {
            setEditing(undefined);
            setFormOpen(true);
          }}
          className="mt-2 inline-flex cursor-pointer items-center gap-2 py-3 text-[13px] leading-[19px] font-bold tracking-[0.4px] text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus"
        >
          <Plus className="size-[18px]" strokeWidth={1.5} aria-hidden /> New template
        </button>
      ) : null}

      {formOpen ? (
        <TemplateFormDialog key={editing?.id ?? "new"} template={editing} open={formOpen} onOpenChange={setFormOpen} />
      ) : null}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.messageTemplateTitle}?</AlertDialogTitle>
            <AlertDialogDescription>Permanent. Messages sent from it keep their text but no longer name the template.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) del.mutate({ id: deleting.id, permanent: true }, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
