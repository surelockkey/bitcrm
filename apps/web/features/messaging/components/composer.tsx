"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { ChevronUp, FileText, ImageIcon, Loader2, Paperclip, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  MESSAGE_ATTACHMENT_LIMIT,
  MESSAGE_ATTACHMENT_TYPES,
  SMS_BODY_MAX_LENGTH,
  type MessageTemplate,
} from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { QuickReplies } from "./quick-replies";
import { ShortCodeMenu } from "./short-code-menu";

const ACCEPT = MESSAGE_ATTACHMENT_TYPES.join(",");
const ACCEPTED = new Set<string>(MESSAGE_ATTACHMENT_TYPES);

type Channel = "sms" | "email";
const SEND_LABEL: Record<Channel, string> = { sms: "Send Text", email: "Send Email" };

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
  /** Text the box opens with — a forwarded message. */
  initialText?: string;
  /** The template chips above the box (Workiz quick replies). */
  quickReplies?: boolean;
  /** The send itself; the composer clears on resolve and keeps the draft on reject. */
  onSend: (body: SendMessageBody) => Promise<unknown>;
  className?: string;
}

const boxIcon =
  "grid size-8 place-items-center rounded-md text-foreground/70 transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * The Workiz composer: the quick-reply chips, then a box saying "Type your
 * message here…" with the AI sparkle, short codes and the paperclip inside
 * it, and the yellow "Send Text" button to its right — with a chevron to
 * switch to Email (where the thread has an address) or pick the sending
 * number. Templates, short codes, attachments (button or paste) and the
 * GSM-7 / UCS-2 segment counter all stay. Enter sends, Shift+Enter breaks
 * a line.
 */
export function Composer({
  conversation,
  contactId,
  dealId,
  optedOut = false,
  disabled = false,
  autoFocus = false,
  placeholder = "Type your message here...",
  initialText = "",
  quickReplies = true,
  onSend,
  className,
}: ComposerProps) {
  const { canSend } = useMessagingAccess();
  const [text, setText] = useState(initialText);
  const [subject, setSubject] = useState("");
  const [channel, setChannel] = useState<Channel>("sms");
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

  // Email is offered only where the thread has an address to send to.
  const emailPossible = !!conversation?.addresses?.emails?.length;
  const hasOptions = emailPossible || (numbers?.length ?? 0) > 0;

  const segments = countSegments(text);
  const tooLong = channel === "sms" && text.length > SMS_BODY_MAX_LENGTH;
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
        fromNumber: channel === "sms" && from !== "auto" ? from : undefined,
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
    <div className={cn("shrink-0", className)} data-testid="composer">
      {quickReplies ? (
        <QuickReplies channel={channel} onPick={pickTemplate} disabled={blocked} pending={render.isPending} />
      ) : null}

      <div className="flex items-end gap-3 border-t bg-muted/40 px-4 py-3">
        {/* The box: the text, and the tools that belong to it, inside one border. */}
        <div
          className={cn(
            "relative flex min-w-0 flex-1 flex-col rounded-lg border bg-background transition-colors focus-within:border-brand",
            blocked && "opacity-70",
          )}
        >
          {channel === "email" ? (
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="rounded-b-none border-0 border-b shadow-none focus-visible:ring-0"
              aria-label="Subject"
              disabled={blocked}
            />
          ) : null}

          <textarea
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
            className="max-h-48 min-h-16 w-full resize-none bg-transparent px-4 pb-1 pt-3 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />

          {attachments.length > 0 || uploading > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pb-1">
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

          <div className="flex items-center gap-2 px-2 pb-1.5">
            {text.length > 0 && channel === "sms" ? (
              <span
                className={cn("ml-2 text-[11px] tabular-nums text-muted-foreground", tooLong && "font-medium text-destructive")}
                aria-live="polite"
                data-testid="segment-counter"
              >
                {tooLong
                  ? `${text.length} / ${SMS_BODY_MAX_LENGTH} — too long`
                  : `${segments.encoding} · ${segments.units}/${segments.perSegment * Math.max(segments.segments, 1)} · ${segments.segments || 1} segment${segments.segments > 1 ? "s" : ""}`}
              </span>
            ) : null}
            <span className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <button type="button" disabled aria-label="AI suggestions" className={cn(boxIcon, "text-brand")}>
                    <Sparkles className="size-4" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent>AI replies arrive with a later milestone</TooltipContent>
            </Tooltip>
            <ShortCodeMenu onInsert={insert} disabled={blocked} compact />
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
            <button
              type="button"
              className={boxIcon}
              disabled={blocked || attachments.length >= MESSAGE_ATTACHMENT_LIMIT}
              onClick={() => fileRef.current?.click()}
              aria-label="Attach a file"
            >
              <Paperclip className="size-4" />
            </button>
          </div>
        </div>

        {/* "Send Text", with the chevron for Text / Email and the sending number. */}
        <div className="flex h-10 shrink-0 items-stretch overflow-hidden rounded-lg">
          <Button
            type="button"
            variant="brand"
            className={cn("h-10 rounded-none px-4 font-semibold", hasOptions && "border-r border-brand-foreground/25")}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : null}
            {SEND_LABEL[channel]}
          </Button>
          {hasOptions ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="brand"
                  className="h-10 w-9 rounded-none px-0"
                  aria-label="Send options"
                  disabled={blocked}
                >
                  <ChevronUp className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                {emailPossible ? (
                  <>
                    <DropdownMenuLabel>Send as</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                      <DropdownMenuRadioItem value="sms">Text</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="email">Email</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </>
                ) : null}
                {numbers && numbers.length > 0 ? (
                  <>
                    {emailPossible ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuLabel>Send from</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={from} onValueChange={setFromNumber}>
                      <DropdownMenuRadioItem value="auto">Best match</DropdownMenuRadioItem>
                      {numbers.map((n) => (
                        <DropdownMenuRadioItem key={n.sid} value={n.phoneNumber}>
                          {formatPhone(n.phoneNumber)}
                          {n.friendlyName && n.friendlyName !== n.phoneNumber ? (
                            <span className="ml-auto pl-2 text-xs text-muted-foreground">{n.friendlyName}</span>
                          ) : null}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {optedOut ? (
        <div className="bg-muted/40 px-4 pb-2 text-[11px] text-muted-foreground">
          The recipient opted out; they can text START to opt back in.
        </div>
      ) : null}
    </div>
  );
}
