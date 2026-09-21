"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, MessageSquareText, Send } from "lucide-react";
import { toast } from "sonner";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { useContact } from "@/features/clients/hooks";
import { sendToParty } from "@/features/messaging/api";
import { countSegments } from "@/features/messaging/segments";
import { useCompanyName } from "@/features/business-profiles/hooks";
import { usePortalLinkUrl } from "../hooks";
import { defaultSendText } from "../send-message";

/** What the dialog needs to know about the document it sends. */
export interface SendableDocument {
  kind: "invoice" | "estimate";
  id: string;
  number: string;
  total: number;
  contactId: string;
  dealId: string;
  /** The job's company, for the "from …" in the text. */
  businessProfileId?: string;
  alreadySent: boolean;
}

/**
 * "Send to the client by text": the portal link goes out over the messaging
 * service (Twilio), from the company's number, into the client's thread.
 *
 * Order matters: the client's portal shows SENT documents only, so the
 * document is marked sent first — otherwise the link would open an empty page.
 * If the text then fails, the document stays marked sent and the dialog stays
 * open for another try (the same idempotency key makes a retry safe).
 */
export function SendDocumentDialog({
  document: doc,
  open,
  onOpenChange,
  markSent,
}: {
  document: SendableDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Marks the document sent (resolves once it is). Skipped when it already is. */
  markSent: () => Promise<unknown>;
}) {
  const contact = useContact(open ? doc.contactId : "");
  const companyName = useCompanyName();
  const link = usePortalLinkUrl(doc.contactId);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);
  const key = useRef<string>("");
  const requested = useRef(false);

  // Each time the dialog opens: a fresh idempotency key and the client's link.
  useEffect(() => {
    if (!open) {
      requested.current = false;
      return;
    }
    if (requested.current) return;
    requested.current = true;
    key.current = crypto.randomUUID();
    setError(null);
    setText("");
    link.mutate(undefined, { onSuccess: (l) => setReplaced(!!l.replaced) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per open
  }, [open]);

  const url = link.data?.url;
  const c: Contact | undefined = contact.data;
  const business = companyName(doc.businessProfileId);
  const ready = !!url && !!c;

  // Prefill once both the link and the client's name are known; the user's edits are never overwritten.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) seeded.current = false;
    if (open && ready && !seeded.current) {
      seeded.current = true;
      setText(defaultSendText({ kind: doc.kind, number: doc.number, total: doc.total, firstName: c.firstName, businessName: business, url }));
    }
  }, [open, ready, c, url, business, doc.kind, doc.number, doc.total]);

  const phones = c?.phones ?? [];
  const hasPhone = phones.length > 0 || (c?.phoneCount ?? 0) > 0;
  const segments = countSegments(text);
  const canSend = ready && hasPhone && text.trim().length > 0 && text.includes(url ?? "\0") && !sending;
  const noun = doc.kind === "invoice" ? "invoice" : "estimate";

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      if (!doc.alreadySent) await markSent();
    } catch (e) {
      setError(getApiErrorMessage(e, `Couldn't mark the ${noun} as sent`));
      setSending(false);
      return;
    }
    try {
      await sendToParty({
        contactId: doc.contactId,
        channel: "sms",
        body: text.trim(),
        clientMessageId: key.current,
        dealId: doc.dealId,
      });
      toast.success(`Text sent to ${c ? c.firstName : "the client"}`);
      onOpenChange(false);
    } catch (e) {
      const why = getApiErrorMessage(e, "The text couldn't be sent");
      setError(doc.alreadySent ? why : `${why} The ${noun} is marked as sent, so you can try again.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {noun} #{doc.number} by text</DialogTitle>
          <DialogDescription>
            The client gets a link to their portal, where they can read this {noun} and download the PDF.
          </DialogDescription>
        </DialogHeader>

        {link.isError ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertCircle className="mt-0.5 size-4 flex-none text-destructive" />
            <div className="space-y-2">
              <p>Couldn&apos;t get the client&apos;s portal link.</p>
              <Button variant="outline" size="sm" onClick={() => link.mutate()}>Try again</Button>
            </div>
          </div>
        ) : !ready ? (
          <div className="space-y-2" aria-busy>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm">
              <MessageSquareText className="size-4 flex-none text-muted-foreground" />
              <span>
                To <span className="font-medium">{c.firstName} {c.lastName}</span>
                {phones[0] ? <span className="text-muted-foreground"> · {formatPhone(phones[0])}</span> : null}
              </span>
            </p>
            {!hasPhone ? (
              <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-sm text-amber-800 dark:text-amber-300">
                This client has no phone number on file, so there&apos;s nowhere to send a text. Add one to the client first.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <label htmlFor="send-text" className="text-sm font-medium">Message</label>
              <Textarea
                id="send-text"
                rows={5}
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={sending}
                aria-describedby="send-text-hint"
              />
              <p id="send-text-hint" className="flex justify-between gap-2 text-xs text-muted-foreground">
                <span>
                  {text.includes(url!) ? "Keep the link in the message." : <span className="text-destructive">The message must contain the portal link.</span>}
                </span>
                <span className="tabular-nums">{segments.units} chars · {segments.segments} SMS</span>
              </p>
            </div>
            {!doc.alreadySent ? (
              <p className="text-xs text-muted-foreground">The {noun} will be marked as sent so the client can open it.</p>
            ) : null}
            {replaced ? (
              <p className="text-xs text-muted-foreground">
                A new portal link was created for this client; their earlier link no longer works.
              </p>
            ) : null}
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button variant="brand" onClick={send} disabled={!canSend}>
            {sending ? <Loader2 className="animate-spin" /> : <Send />} Send text
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
