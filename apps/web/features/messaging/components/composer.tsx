"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, Send, X } from "lucide-react";
import { toast } from "sonner";
import {
  MESSAGE_ATTACHMENT_LIMIT,
  MESSAGE_ATTACHMENT_TYPES,
  SMS_BODY_MAX_LENGTH,
  type MessageTemplate,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useNumbers } from "@/features/telephony/numbers-hooks";
import { uploadAttachment, type InboxConversation, type SendAttachment, type SendMessageBody } from "../api";
import { useMessagingAccess, usePreviewTemplate, useRenderTemplate } from "../hooks";
import {
  formatBytes,
  hasShortCodes,
  insertAtCursor,
  MAX_ATTACHMENT_BYTES,
  newClientMessageId,
} from "../lib";
import { countSegments } from "../segments";
import { ShortCodeMenu } from "./short-code-menu";
import { TemplatePicker } from "./template-picker";

const ACCEPT = MESSAGE_ATTACHMENT_TYPES.join(",");
const ACCEPTED = new Set<string>(MESSAGE_ATTACHMENT_TYPES);

export interface ComposerProps {
  /** The thread being written in, when it exists — sticky sender, render context. */
  conversation?: InboxConversation;
  /** Render context when there is no thread yet (a contact's first text). */
  contactId?: string;
  /** The job this message is about; recorded on the message and used by short codes. */
  dealId?: string;
  optedOut?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** The send itself; the composer clears on resolve and keeps the draft on reject. */
  onSend: (body: SendMessageBody) => Promise<unknown>;
  className?: string;
}

/**
 * The Workiz composer: SMS / Email toggle, templates with short codes,
 * attachments (button or paste), the GSM-7 / UCS-2 segment counter, the
 * sender number, and the STOP notice. Enter sends, Shift+Enter breaks a
 * line. Only SMS is deliverable today, so Email is shown but not enabled.
 */
export function Composer({
  conversation,
  contactId,
  dealId,
  optedOut = false,
  disabled = false,
  autoFocus = false,
  placeholder = "Write a text message…",
  onSend,
  className,
}: ComposerProps) {
  const { canSend } = useMessagingAccess();
  const [text, setText] = useState("");
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [uploading, setUploading] = useState(0);
  /** Undefined until the user picks — the default is derived below. */
  const [fromNumber, setFromNumber] = useState<string | undefined>(undefined);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const render = useRenderTemplate();
  const preview = usePreviewTemplate();
  const { data: numbers } = useNumbers(canSend && !!conversation);

  // The number the client last heard from is what they will recognise, so
  // it is the default whenever the workspace still owns it.
  const sticky = conversation?.lastBusinessNumber;
  const stickyKnown = !!sticky && !!numbers?.some((n) => n.phoneNumber === sticky);
  const from = fromNumber ?? (stickyKnown ? sticky : "auto");

  const segments = countSegments(text);
  const tooLong = text.length > SMS_BODY_MAX_LENGTH;
  const blocked = disabled || !canSend || optedOut;
  const busy = sending || uploading > 0 || render.isPending || preview.isPending;
  const canSubmit = !blocked && !busy && !tooLong && text.trim().length > 0;
  const effectiveContactId = contactId ?? (conversation?.partyKind === "contact" ? conversation.partyId : undefined);
  const effectiveDealId = dealId ?? conversation?.lastDealId;

  const insert = (snippet: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAtCursor(text, snippet, start, end);
    setText(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.caret, next.caret);
    });
  };

  const pickTemplate = async (t: MessageTemplate) => {
    try {
      const rendered = await render.mutateAsync({
        id: t.id,
        ctx: { conversationId: conversation?.id, contactId: effectiveContactId, dealId: effectiveDealId },
      });
      setText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n${rendered.body}` : rendered.body));
      if (rendered.subject && channel === "email") setSubject(rendered.subject);
      setTemplateId(t.id);
      if (rendered.missing.length) {
        toast.warning(`No value for ${rendered.missing.map((m) => `{{${m}}}`).join(", ")} — check the text before sending.`);
      }
      textareaRef.current?.focus();
    } catch {
      /* toasted by the hook */
    }
  };

  const addFiles = async (files: Iterable<File>) => {
    const list = [...files];
    if (!list.length) return;
    const room = MESSAGE_ATTACHMENT_LIMIT - attachments.length;
    if (list.length > room) toast.error(`At most ${MESSAGE_ATTACHMENT_LIMIT} files per message.`);
    const total = attachments.reduce((s, a) => s + a.size, 0);
    let running = total;
    for (const file of list.slice(0, Math.max(room, 0))) {
      if (!ACCEPTED.has(file.type)) {
        toast.error(`${file.name}: ${file.type || "this type"} can't be sent by MMS.`);
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES || running + file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(`${file.name} would take the message over 5 MB.`);
        continue;
      }
      running += file.size;
      setUploading((n) => n + 1);
      try {
        const uploaded = await uploadAttachment(file);
        setAttachments((prev) => [...prev, uploaded]);
      } catch (e) {
        toast.error(`${file.name}: ${getApiErrorMessage(e)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSending(true);
    try {
      let body = text.trim();
      // Free-typed short codes are filled by the server only when a
      // template is named; a draft without one is rendered here first.
      if (!templateId && hasShortCodes(body)) {
        const rendered = await preview.mutateAsync({
          body,
          conversationId: conversation?.id,
          contactId: effectiveContactId,
          dealId: effectiveDealId,
          format: "text",
          keepMissing: false,
        });
        body = rendered.body.trim();
        if (rendered.missing.length) {
          toast.warning(`Sent without ${rendered.missing.map((m) => `{{${m}}}`).join(", ")} — no value was available.`);
        }
        if (!body) {
          toast.error("Nothing left to send once the short codes were filled in.");
          return;
        }
      }
      await onSend({
        clientMessageId: newClientMessageId(),
        channel,
        body,
        subject: channel === "email" && subject.trim() ? subject.trim() : undefined,
        fromNumber: from !== "auto" ? from : undefined,
        dealId,
        templateId,
        attachments: attachments.length ? attachments : undefined,
      });
      setText("");
      setSubject("");
      setTemplateId(undefined);
      setAttachments([]);
      textareaRef.current?.focus();
    } catch {
      /* the mutation toasts; the draft stays */
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  if (!canSend) {
    return (
      <div className={cn("border-t px-4 py-3 text-center text-xs text-muted-foreground", className)}>
        You can read this conversation but not send in it.
      </div>
    );
  }

  return (
    <div className={cn("border-t bg-background", className)} data-testid="composer">
      {/* Channel toggle + sender, Workiz-style, above the box. */}
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2">
        <div role="radiogroup" aria-label="Channel" className="inline-flex rounded-md border p-0.5 text-xs">
          <button
            type="button"
            role="radio"
            aria-checked={channel === "sms"}
            onClick={() => setChannel("sms")}
            className={cn("rounded px-2 py-0.5 font-medium", channel === "sms" ? "bg-muted text-foreground" : "text-muted-foreground")}
          >
            SMS
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <button
                  type="button"
                  role="radio"
                  aria-checked={channel === "email"}
                  disabled
                  className="cursor-not-allowed rounded px-2 py-0.5 font-medium text-muted-foreground opacity-60"
                >
                  Email
                </button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Email sending arrives with the email milestone.</TooltipContent>
          </Tooltip>
        </div>
        {numbers && numbers.length > 0 ? (
          <Select value={from} onValueChange={setFromNumber} disabled={blocked}>
            <SelectTrigger className="h-7 w-auto min-w-40 text-xs" aria-label="Send from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">From: best match</SelectItem>
              {numbers.map((n) => (
                <SelectItem key={n.sid} value={n.phoneNumber}>
                  {formatPhone(n.phoneNumber)}
                  {n.friendlyName && n.friendlyName !== n.phoneNumber ? ` · ${n.friendlyName}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      {channel === "email" ? (
        <div className="px-3 pt-2">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="h-8"
            aria-label="Subject"
            disabled={blocked}
          />
        </div>
      ) : null}

      <div className="px-3 pt-2">
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={optedOut ? "This number opted out — sending is blocked." : placeholder}
          disabled={blocked}
          autoFocus={autoFocus}
          rows={2}
          aria-label="Message"
          aria-invalid={tooLong || undefined}
          className="max-h-48 min-h-14 resize-none text-sm"
        />
      </div>

      {attachments.length > 0 || uploading > 0 ? (
        <div className="flex flex-wrap gap-1.5 px-3 pt-2">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex max-w-56 items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
            >
              {a.contentType.startsWith("image/") ? (
                <ImageIcon className="size-3.5 shrink-0" />
              ) : (
                <FileText className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{a.fileName}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{formatBytes(a.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${a.fileName}`}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
                className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {uploading > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Uploading…
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        <TemplatePicker channel={channel} onPick={pickTemplate} disabled={blocked} pending={render.isPending} />
        <ShortCodeMenu onInsert={insert} disabled={blocked} />
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          aria-label="Attach files"
          onChange={(e) => {
            void addFiles(e.target.files ?? []);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-muted-foreground"
          disabled={blocked || attachments.length >= MESSAGE_ATTACHMENT_LIMIT}
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a file"
        >
          <Paperclip className="size-3.5" /> Attach
        </Button>

        <span className="flex-1" />

        <span
          className={cn("text-[11px] tabular-nums text-muted-foreground", tooLong && "font-medium text-destructive")}
          aria-live="polite"
          data-testid="segment-counter"
        >
          {tooLong
            ? `${text.length} / ${SMS_BODY_MAX_LENGTH} — too long`
            : `${segments.encoding} · ${segments.units}/${segments.perSegment * Math.max(segments.segments, 1)} · ${segments.segments || 1} segment${segments.segments > 1 ? "s" : ""}`}
        </span>
        <Button
          type="button"
          variant="brand"
          size="sm"
          className="gap-1.5"
          disabled={!canSubmit}
          onClick={() => void submit()}
          aria-label="Send"
        >
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send
        </Button>
      </div>

      <div className="px-3 pb-2 text-[11px] text-muted-foreground">
        {optedOut
          ? "The recipient opted out; they can text START to opt back in."
          : "Enter to send · Shift+Enter for a new line · Clients can reply STOP to opt out."}
      </div>
    </div>
  );
}
