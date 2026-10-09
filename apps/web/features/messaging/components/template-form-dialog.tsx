"use client";

import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import type { MessageTemplate, MessageTemplateChannel } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { WzCheckbox } from "@/components/workiz/toggles";
import { cn } from "@/lib/utils";
import { useCreateTemplate, usePreviewTemplate, useShortCodes, useUpdateTemplate } from "../hooks";
import { templateFormSchema, toTemplateBody } from "../schemas";
import { countSegments } from "../segments";
import { templateText } from "../template-text";
import { TextTemplateField } from "./text-template-field";

const CHANNEL_LABEL: Record<MessageTemplateChannel, string> = {
  sms: "SMS",
  email: "Email",
  any: "SMS and email",
};
const CHANNEL_OPTIONS = (Object.keys(CHANNEL_LABEL) as MessageTemplateChannel[]).map((c) => ({ value: c, label: CHANNEL_LABEL[c] }));

/**
 * A message template — Workiz's "+ New template" (its Quick reply list) laid
 * out as its settings modals: the 652px form with notched boxes 24px apart
 * (Title, Channel, Category, Subject for email), the message as one of the
 * Texting tab's text-template boxes (short-code chips under it, our segment
 * count as the helper), then ours: Default / Active, Preview. Cancel / the
 * yellow Save at the bottom right.
 */
export function TemplateFormDialog({
  template,
  open,
  onOpenChange,
}: {
  template?: MessageTemplate;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = !!template;
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const preview = usePreviewTemplate();
  const { data: shortCodes } = useShortCodes(open);
  const pending = create.isPending || update.isPending;

  const [title, setTitle] = useState(template?.messageTemplateTitle ?? "");
  const [body, setBody] = useState(template ? templateText(template.messageTemplate) : "");
  const [subject, setSubject] = useState(template?.messageSubjectTemplate ?? "");
  const [channel, setChannel] = useState<MessageTemplateChannel>(template?.channel ?? "sms");
  const [category, setCategory] = useState(template?.category ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ body: string; missing: string[] } | null>(null);

  const parsed = useMemo(
    () =>
      templateFormSchema.safeParse({
        messageTemplateTitle: title,
        messageTemplate: body,
        messageSubjectTemplate: subject,
        channel,
        category,
        isDefault,
        active,
      }),
    [title, body, subject, channel, category, isDefault, active],
  );
  const segments = countSegments(body);

  const showPreview = async () => {
    try {
      const out = await preview.mutateAsync({
        body,
        subject: channel === "sms" ? undefined : subject || undefined,
        format: channel === "email" ? "html" : "text",
        keepMissing: true,
      });
      setRendered({ body: out.body, missing: out.missing });
    } catch {
      /* toasted */
    }
  };

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const payload = toTemplateBody(parsed.data);
    if (editing) {
      update.mutate({ id: template.id, body: payload }, { onSuccess: () => onOpenChange(false) });
    } else {
      create.mutate(payload, { onSuccess: () => onOpenChange(false) });
    }
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${template.messageTemplateTitle}` : "New template"}
      onSave={submit}
      saveLabel={editing ? "Save" : "Create template"}
      saving={pending}
      error={error}
      className="max-h-[92vh] w-[652px] overflow-y-auto sm:max-w-[652px]"
    >
      <WzOutlinedTextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="grid grid-cols-2 gap-4">
        <WzOutlinedSelect label="Channel" options={CHANNEL_OPTIONS} value={channel} onChange={(v) => setChannel(v as MessageTemplateChannel)} />
        <WzOutlinedTextField label="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      {channel !== "sms" ? (
        <WzOutlinedTextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
      ) : null}

      <TextTemplateField
        label="Message"
        value={body}
        onChange={setBody}
        rows={6}
        placeholder="Hi {{first_name}}, {{tech_assigned}} is on the way to {{job_address}}."
        codes={(shortCodes ?? []).map((c) => c.code)}
        helper={
          channel !== "email" ? (
            <span className={cn(body.length > 1600 && "text-wz-error")}>
              {segments.encoding} · {segments.units} characters · {segments.segments || 1} segment
              {segments.segments > 1 ? "s" : ""} (before short codes are filled in)
            </span>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-6">
        <WzCheckbox label={`Default for ${CHANNEL_LABEL[channel].toLowerCase()}`} checked={isDefault} onCheckedChange={setIsDefault} />
        {editing ? <WzCheckbox label="Active" checked={active} onCheckedChange={setActive} /> : null}
        <WzButton
          variant="secondary"
          size="regular"
          className="ml-auto"
          icon={<Eye />}
          loading={preview.isPending}
          disabled={!body.trim()}
          onClick={() => void showPreview()}
        >
          Preview
        </WzButton>
      </div>

      {rendered ? (
        <div className="rounded-[4px] bg-muted p-3 text-[13px] leading-4 text-foreground" data-testid="template-preview">
          <div className="mb-1 text-[11px] font-semibold tracking-wide text-wz-slate uppercase">Preview</div>
          <p className="break-words whitespace-pre-wrap">{rendered.body}</p>
          {rendered.missing.length ? (
            <p className="mt-1.5 text-[11px] text-wz-slate">
              Left for the send to fill: {rendered.missing.map((m) => `{{${m}}}`).join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </WzFormModal>
  );
}
