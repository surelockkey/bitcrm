"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircle, ChevronDown, Loader2, Mail, MessageSquareText, X } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_DOCUMENT_VISIBILITY, type Contact, type DocumentVisibility, type OnlinePaymentMethod } from "@bitcrm/types";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { useContact } from "@/features/clients/hooks";
import { sendToParty } from "@/features/messaging/api";
import { countSegments } from "@/features/messaging/segments";
import { useBusinessProfiles } from "@/features/business-profiles/hooks";
import { useDocumentSettings } from "@/features/documents/hooks";
import { updateEstimate } from "@/features/estimates/api";
import { updateInvoice } from "@/features/invoices/api";
import { useSetAllowedMethods } from "@/features/payments/hooks";
import { sameMethods } from "@/features/payments/lib";
import { AllowedMethodsField } from "@/features/payments/components/allowed-methods-field";
import { usePortalLinkUrl } from "../hooks";
import { sendMessageFor, type SendDocumentKind } from "../send-message";

/** What the panel needs to know about the document it sends. */
export interface SendableDocument {
  kind: SendDocumentKind;
  id: string;
  /** Empty for a proposal that is created by the send itself. */
  number: string;
  total: number;
  contactId: string;
  /** The job; absent for a client document (no job). */
  dealId?: string;
  /** The job's company, for the "from …" in the text. */
  businessProfileId?: string;
  alreadySent: boolean;
  /**
   * Invoices only — the methods this document offers the client. Absent means
   * "whatever the account allows", which is where an untouched invoice sits.
   */
  allowedMethods?: OnlinePaymentMethod[];
  /** Invoices only — Workiz "Request signature". Absent ⇒ the account default. */
  requestSignature?: boolean;
  /** Workiz "Advanced": the document's own choice of what the client sees. */
  display?: Partial<DocumentVisibility>;
}

/** Which button is the primary one: a text from the company's number, or an email (SES). */
export type SendDocumentChannel = "sms" | "email";

/** The Advanced section (Workiz "choose all of the details you want your client to see"). */
const ADVANCED: Array<{ key: keyof DocumentVisibility; label: string }> = [
  { key: "quantity", label: "Quantity" },
  { key: "unitPrice", label: "Price" },
  { key: "lineAmount", label: "Line total" },
  { key: "description", label: "Item description" },
  { key: "sku", label: "SKU" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The Workiz Send panel: one slide-over with From / To / Cc / Subject / Phone /
 * Message, "Let client pay with", "Request signature", Advanced, and two
 * buttons — Send email, Send text. The portal link goes out over the
 * messaging service (Twilio SMS or SES email) into the client's thread.
 *
 * Order matters: the client's portal shows SENT documents only, so the
 * document's options are saved and it is marked sent first — otherwise the
 * link would open an empty page. If the message then fails, the document
 * stays marked sent and the panel stays open for another try (the same
 * idempotency key makes a retry safe).
 */
export function SendDocumentDialog({
  document: doc,
  channel = "sms",
  open,
  onOpenChange,
  markSent,
}: {
  document: SendableDocument;
  channel?: SendDocumentChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Marks the document sent (resolves once it is). Skipped when it already is. For a proposal: creates and sends it. */
  markSent: () => Promise<unknown>;
}) {
  const qc = useQueryClient();
  const contact = useContact(open ? doc.contactId : "");
  const { data: companies } = useBusinessProfiles(open);
  const { data: documentSettings } = useDocumentSettings(open);
  const link = usePortalLinkUrl(doc.contactId);
  const [text, setText] = useState("");
  // null = not touched yet: the default subject.
  const [subjectEdit, setSubject] = useState<string | null>(null);
  const [toEmails, setToEmails] = useState<string[] | null>(null);
  const [cc, setCc] = useState<string[]>([]);
  const [phonePick, setPhone] = useState<string | null>(null);
  const [sending, setSending] = useState<SendDocumentChannel | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = this invoice has never been narrowed, so the account's methods
  // apply. Ticking a box makes it an explicit list on this document.
  const [allowed, setAllowed] = useState<OnlinePaymentMethod[] | null>(doc.allowedMethods ?? null);
  const [requestSignature, setRequestSignature] = useState<boolean | null>(doc.requestSignature ?? null);
  const [display, setDisplay] = useState<Partial<DocumentVisibility>>(doc.display ?? {});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const saveAllowed = useSetAllowedMethods(doc.id, doc.dealId);
  const key = useRef<string>("");
  const requested = useRef(false);

  // Each time the panel opens: a fresh idempotency key and the client's link.
  useEffect(() => {
    if (!open) {
      requested.current = false;
      return;
    }
    if (requested.current) return;
    requested.current = true;
    key.current = crypto.randomUUID();
    setError(null);
    setAllowed(doc.allowedMethods ?? null);
    setRequestSignature(doc.requestSignature ?? null);
    setDisplay(doc.display ?? {});
    setAdvancedOpen(false);
    setText("");
    setSubject(null);
    setToEmails(null);
    setCc([]);
    setPhone(null);
    link.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [open]);

  const url = link.data?.url;
  const c: Contact | undefined = contact.data;
  const company = companies?.find((b) => b.id === doc.businessProfileId) ?? companies?.find((b) => b.isDefault) ?? companies?.[0];
  const business = company?.name;
  const ready = !!url && !!c;

  const defaults = useMemo(
    () =>
      ready
        ? sendMessageFor(documentSettings, {
            kind: doc.kind,
            number: doc.number,
            total: doc.total,
            firstName: c.firstName,
            lastName: c.lastName,
            businessName: business,
            url,
          })
        : null,
    [ready, documentSettings, doc.kind, doc.number, doc.total, c, business, url],
  );

  // Prefill once both the link and the client's name are known; the user's edits are never overwritten.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) seeded.current = false;
    if (open && defaults && !seeded.current) {
      seeded.current = true;
      setText(defaults.body);
    }
  }, [open, defaults]);

  const phones = c?.phones ?? [];
  const emails = c?.emails ?? [];
  const subject = subjectEdit ?? defaults?.subject ?? "";
  const to = toEmails ?? (emails[0] ? [emails[0]] : []);
  const phone = phonePick ?? phones[0] ?? "";
  const hasPhone = phones.length > 0 || (c?.phoneCount ?? 0) > 0;
  const hasEmail = emails.length > 0 || to.length > 0;
  const segments = countSegments(text);
  const hasLink = text.includes(url ?? "\0");
  const baseOk = ready && text.trim().length > 0 && hasLink && sending === null;
  const canText = baseOk && hasPhone;
  const canEmail = baseOk && to.length > 0 && subject.trim().length > 0;
  const invoice = doc.kind === "invoice";
  const noun = doc.kind;
  const effectiveSignature = requestSignature ?? documentSettings?.requestInvoiceSignature ?? true;
  const displayChanged = JSON.stringify(normalizeDisplay(display)) !== JSON.stringify(normalizeDisplay(doc.display ?? {}));

  /** The document's own copy must carry the right options before the link goes out. */
  const saveOptions = async () => {
    if (invoice && allowed && !sameMethods(allowed, doc.allowedMethods)) {
      try {
        await saveAllowed.mutateAsync(allowed);
      } catch (e) {
        throw new Error(getApiErrorMessage(e, "Couldn't save the payment options"));
      }
    }
    const patch: { requestSignature?: boolean; display?: Partial<DocumentVisibility> | null } = {};
    if (invoice && requestSignature !== null && requestSignature !== (doc.requestSignature ?? null)) {
      patch.requestSignature = requestSignature;
    }
    if (displayChanged) patch.display = normalizeDisplay(display) ?? null;
    if (Object.keys(patch).length === 0 || doc.kind === "proposal") return;
    try {
      if (invoice) await updateInvoice(doc.id, patch);
      else await updateEstimate(doc.id, patch);
      qc.invalidateQueries({ queryKey: invoice ? queryKeys.invoices.detail(doc.id) : queryKeys.estimates.detail(doc.id) });
      if (doc.dealId) {
        qc.invalidateQueries({ queryKey: invoice ? queryKeys.invoices.byDeal(doc.dealId) : queryKeys.estimates.byDeal(doc.dealId) });
      }
    } catch (e) {
      throw new Error(getApiErrorMessage(e, "Couldn't save the send options"));
    }
  };

  const send = async (via: SendDocumentChannel) => {
    if (via === "sms" ? !canText : !canEmail) return;
    setSending(via);
    setError(null);
    try {
      await saveOptions();
    } catch (e) {
      setError((e as Error).message);
      setSending(null);
      return;
    }
    try {
      if (!doc.alreadySent) await markSent();
    } catch (e) {
      setError(getApiErrorMessage(e, `Couldn't mark the ${noun} as sent`));
      setSending(null);
      return;
    }
    try {
      // Messaging takes ONE recipient; the other To addresses ride along as Cc.
      const [first, ...moreTo] = to;
      const ccAll = [...moreTo, ...cc].filter((a, i, all) => a !== first && all.indexOf(a) === i).slice(0, 5);
      await sendToParty({
        contactId: doc.contactId,
        channel: via,
        body: text.trim(),
        ...(via === "email"
          ? { subject: subject.trim(), toAddress: first, ...(ccAll.length ? { cc: ccAll } : {}) }
          : phonePick
            ? { toAddress: phonePick }
            : {}),
        clientMessageId: key.current,
        dealId: doc.dealId,
      });
      toast.success(`${via === "email" ? "Email" : "Text"} sent to ${c ? c.firstName : "the client"}`);
      onOpenChange(false);
    } catch (e) {
      const why = getApiErrorMessage(e, `The ${via === "email" ? "email" : "text"} couldn't be sent`);
      setError(doc.alreadySent ? why : `${why} The ${noun} is marked as sent, so you can try again.`);
    } finally {
      setSending(null);
    }
  };

  const title =
    doc.kind === "proposal"
      ? "Send sales proposal"
      : `Send ${noun} #${doc.number}`;

  return (
    <Sheet open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetDescription>
            {doc.kind === "proposal"
              ? "The client gets a link to their portal with every option side by side; they approve one by signing it."
              : `The client gets a link to their portal, where they can read this ${noun}${invoice ? ", sign it and pay it" : " and approve it by signing"}.`}
          </SheetDescription>
        </SheetHeader>

        {link.isError ? (
          <div className="m-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 flex-none text-destructive" />
            <div className="space-y-2">
              <p>Couldn&apos;t get the client&apos;s portal link.</p>
              <Button variant="outline" size="sm" onClick={() => link.mutate(undefined)}>Try again</Button>
            </div>
          </div>
        ) : !ready ? (
          <div className="space-y-3 p-5" aria-busy>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="send-from">From</Label>
              <Input id="send-from" value={company?.email ?? ""} readOnly className="h-9 bg-muted/40" />
            </div>

            <AddressChips
              id="send-to"
              label="To"
              values={to}
              suggestions={emails}
              onChange={setToEmails}
              disabled={sending !== null}
            />
            <AddressChips
              id="send-cc"
              label="Cc"
              values={cc}
              suggestions={emails.filter((e) => !to.includes(e))}
              onChange={setCc}
              disabled={sending !== null}
            />
            {!hasEmail ? (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                This client has no email address on file — add one above to send an email.
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="send-subject">Subject</Label>
              <Input
                id="send-subject"
                value={subject}
                maxLength={250}
                onChange={(e) => setSubject(e.target.value)}
                disabled={sending !== null}
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="send-phone">Phone</Label>
              {phones.length > 1 ? (
                <Select value={phone} onValueChange={setPhone} disabled={sending !== null}>
                  <SelectTrigger id="send-phone" className="w-full" aria-label="Phone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {phones.map((p) => (
                      <SelectItem key={p} value={p}>
                        {formatPhone(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div
                  id="send-phone"
                  aria-label="Phone"
                  className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm"
                >
                  {phones[0]
                    ? formatPhone(phones[0])
                    : hasPhone
                      ? "The client's number (hidden)"
                      : "None on file"}
                </div>
              )}
              {!hasPhone ? (
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  This client has no phone number on file, so there&apos;s nowhere to send a text.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="send-text">Message</Label>
              <Textarea
                id="send-text"
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={sending !== null}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                {!hasLink ? (
                  <span className="text-destructive">The message must contain the portal link.</span>
                ) : (
                  <span>
                    {segments.segments} SMS segment{segments.segments === 1 ? "" : "s"} as a text
                  </span>
                )}
                {!doc.alreadySent ? (
                  <span>
                    The {noun} will be marked as sent so the client can open it.
                  </span>
                ) : null}
              </div>
            </div>

            {invoice ? (
              <AllowedMethodsField value={allowed} onChange={setAllowed} disabled={sending !== null} />
            ) : null}

            {invoice ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={effectiveSignature}
                  disabled={sending !== null}
                  aria-label="Request signature"
                  onCheckedChange={(v) => setRequestSignature(v === true)}
                />
                Request signature
                <span className="text-xs text-muted-foreground">— the client signs before paying</span>
              </label>
            ) : null}

            {doc.kind !== "proposal" ? (
              <div className="space-y-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
                  onClick={() => setAdvancedOpen((o) => !o)}
                  aria-expanded={advancedOpen}
                >
                  Advanced <ChevronDown className={cn("size-4 transition-transform", advancedOpen && "rotate-180")} />
                </button>
                {advancedOpen ? (
                  <fieldset className="space-y-2 rounded-md border p-3">
                    <legend className="px-1 text-xs text-muted-foreground">What the client sees on this {noun}</legend>
                    <div className="grid grid-cols-2 gap-2">
                      {ADVANCED.map(({ key: k, label }) => (
                        <label key={k} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={display[k] ?? DEFAULT_DOCUMENT_VISIBILITY[k]}
                            disabled={sending !== null}
                            aria-label={label}
                            onCheckedChange={(v) => setDisplay((d) => ({ ...d, [k]: v === true }))}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-sm">
                {error}
              </p>
            ) : null}
          </div>
        )}

        <div className="sticky bottom-0 mt-auto flex gap-2 border-t bg-popover px-5 py-3">
          <Button
            variant={channel === "email" ? "brand" : "outline"}
            className="flex-1"
            disabled={!canEmail}
            onClick={() => send("email")}
          >
            {sending === "email" ? <Loader2 className="animate-spin" /> : <Mail />} Send email
          </Button>
          <Button
            variant={channel === "sms" ? "brand" : "outline"}
            className="flex-1"
            disabled={!canText}
            onClick={() => send("sms")}
          >
            {sending === "sms" ? <Loader2 className="animate-spin" /> : <MessageSquareText />} Send text
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Only keys that differ from nothing: an empty choice is "the template's own". */
function normalizeDisplay(d: Partial<DocumentVisibility>): Partial<DocumentVisibility> | undefined {
  const out: Partial<DocumentVisibility> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "boolean") out[k as keyof DocumentVisibility] = v;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Email addresses as chips (Workiz To / Cc): Enter, comma or blur adds one;
 * the client's own addresses are offered as suggestions.
 */
function AddressChips({
  id,
  label,
  values,
  suggestions,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  values: string[];
  suggestions: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listId = `${id}-suggestions`;
  const add = (raw: string) => {
    const addr = raw.trim().toLowerCase().replace(/,$/, "");
    if (!addr) return;
    if (!EMAIL.test(addr)) return;
    if (!values.includes(addr)) onChange([...values, addr]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <fieldset className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border px-2 py-1 focus-within:ring-2 focus-within:ring-ring/50">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              className="text-muted-foreground hover:text-foreground"
              disabled={disabled}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          list={listId}
          type="email"
          value={draft}
          disabled={disabled}
          placeholder={values.length ? "" : "name@example.com"}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
        />
        <datalist id={listId}>
          {suggestions.filter((s) => !values.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </fieldset>
  );
}
