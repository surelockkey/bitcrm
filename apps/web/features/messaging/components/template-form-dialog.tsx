"use client";

import { useMemo, useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import type { MessageTemplate, MessageTemplateChannel } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCreateTemplate, usePreviewTemplate, useUpdateTemplate } from "../hooks";
import { insertAtCursor } from "../lib";
import { templateFormSchema, toTemplateBody } from "../schemas";
import { countSegments } from "../segments";
import { ShortCodeMenu } from "./short-code-menu";

const CHANNEL_LABEL: Record<MessageTemplateChannel, string> = {
  sms: "SMS",
  email: "Email",
  any: "SMS and email",
};

/** Workiz stores HTML; the editor shows and edits the text form of it. */
const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

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
  const pending = create.isPending || update.isPending;

  const [title, setTitle] = useState(template?.messageTemplateTitle ?? "");
  const [body, setBody] = useState(template ? htmlToText(template.messageTemplate) : "");
  const [subject, setSubject] = useState(template?.messageSubjectTemplate ?? "");
  const [channel, setChannel] = useState<MessageTemplateChannel>(template?.channel ?? "sms");
  const [category, setCategory] = useState(template?.category ?? "");
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  const [active, setActive] = useState(template?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<{ body: string; missing: string[] } | null>(null);
  const [caret, setCaret] = useState<number | null>(null);

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

  const insertCode = (code: string) => {
    const next = insertAtCursor(body, code, caret ?? body.length);
    setBody(next.value);
    setCaret(next.caret);
  };

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${template.messageTemplateTitle}` : "New template"}</DialogTitle>
          <DialogDescription>
            A canned message with <code className="rounded bg-muted px-1">{"{{short_codes}}"}</code> the
            composer fills in for the client and the job.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-title">Title</Label>
              <Input id="tpl-title" className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="On my way" />
            </div>
            <div className="space-y-1.5">
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as MessageTemplateChannel)}>
                <SelectTrigger className="h-9 w-full" aria-label="Channel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CHANNEL_LABEL) as MessageTemplateChannel[]).map((c) => (
                    <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Category</Label>
              <Input id="tpl-category" className="h-9" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Follow-up" />
            </div>
            {channel !== "sms" ? (
              <div className="space-y-1.5">
                <Label htmlFor="tpl-subject">Subject</Label>
                <Input id="tpl-subject" className="h-9" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Your appointment with {{biz_name}}" />
              </div>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="tpl-body">Message</Label>
              <ShortCodeMenu onInsert={insertCode} compact />
            </div>
            <Textarea
              id="tpl-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setCaret(e.target.selectionStart);
              }}
              onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
              rows={6}
              placeholder="Hi {{first_name}}, {{tech_name}} is on the way to {{job_address}}."
              className="min-h-32 text-sm"
            />
            {channel !== "email" ? (
              <p className={cn("text-[11px] text-muted-foreground", body.length > 1600 && "text-destructive")}>
                {segments.encoding} · {segments.units} characters · {segments.segments || 1} segment{segments.segments > 1 ? "s" : ""}
                {" "}(before short codes are filled in)
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={isDefault} onCheckedChange={setIsDefault} aria-label="Default for the channel" />
              Default for {CHANNEL_LABEL[channel].toLowerCase()}
            </label>
            {editing ? (
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={active} onCheckedChange={setActive} aria-label="Active" />
                {active ? "Active" : "Archived"}
              </label>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={() => void showPreview()} disabled={!body.trim() || preview.isPending}>
              {preview.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
              Preview
            </Button>
          </div>

          {rendered ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="template-preview">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Preview</div>
              <p className="whitespace-pre-wrap break-words">{rendered.body}</p>
              {rendered.missing.length ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Left for the send to fill: {rendered.missing.map((m) => `{{${m}}}`).join(", ")}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant="brand" onClick={submit} disabled={pending} className="gap-1.5">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
