import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from "@bitcrm/types";
import { formatMoney } from "@/features/billing/lib";

export type SendDocumentKind = "invoice" | "estimate" | "proposal";

/** What a send message can mention — the short codes of Settings → Documents → Messages. */
export interface SendMessageContext {
  kind: SendDocumentKind;
  number: string;
  total: number;
  firstName?: string;
  lastName?: string;
  businessName?: string;
  /** The client's portal link. */
  url: string;
}

const CODE = /\{\{\s*([a-zA-Z_.]+)\s*\}\}/g;

/** Fills `{{client.firstName}}`, `{{business.name}}`, `{{document.total}}`, `{{portal_link}}`, …; an unknown code renders blank. */
export function renderSendMessage(template: string, ctx: SendMessageContext): string {
  const fullName = [ctx.firstName, ctx.lastName].map((p) => p?.trim()).filter(Boolean).join(" ");
  const values: Record<string, string> = {
    "client.firstName": ctx.firstName?.trim() ?? "",
    "client.lastName": ctx.lastName?.trim() ?? "",
    "client.fullName": fullName,
    "business.name": ctx.businessName ?? "",
    "document.number": ctx.number,
    "document.total": formatMoney(ctx.total),
    portal_link: ctx.url,
  };
  return template.replace(CODE, (_m, code: string) => values[code] ?? "");
}

/** The subject and message the staff member starts from — the account's template for this kind of document. */
export function sendMessageFor(
  settings: DocumentSettings | undefined,
  ctx: SendMessageContext,
): { subject: string; body: string } {
  // Field by field: a half-saved settings row still has every message.
  const s: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS, ...(settings ?? {}) };
  const [subject, message] =
    ctx.kind === "invoice"
      ? [s.invoiceEmailSubject, s.invoiceMessage]
      : ctx.kind === "estimate"
        ? [s.estimateEmailSubject, s.estimateMessage]
        : [s.proposalEmailSubject, s.proposalMessage];
  return { subject: renderSendMessage(subject, ctx), body: renderSendMessage(message, ctx) };
}
