import type { PortalDocumentSummary } from "@bitcrm/types";
import { formatMoney } from "@/features/billing/lib";

type Kind = PortalDocumentSummary["kind"];

/** The text a client gets with their link — the staff member edits it before it goes. */
export function defaultSendText(input: {
  kind: Kind;
  number: string;
  total: number;
  firstName?: string;
  businessName?: string;
  url: string;
}): string {
  const who = input.firstName?.trim() ? `Hi ${input.firstName.trim()}, your` : "Your";
  const from = input.businessName ? ` from ${input.businessName}` : "";
  const what = input.kind === "invoice" ? "invoice" : "estimate";
  const ask = input.kind === "invoice" ? "View and pay it here" : "View it here";
  return `${who} ${what} #${input.number}${from} is ready (${formatMoney(input.total)}). ${ask}: ${input.url}`;
}

/** The subject and body of the email a client gets with their link — edited before it goes. */
export function defaultSendEmail(input: {
  kind: Kind;
  number: string;
  total: number;
  firstName?: string;
  businessName?: string;
  url: string;
}): { subject: string; body: string } {
  const what = input.kind === "invoice" ? "invoice" : "estimate";
  const from = input.businessName ? ` from ${input.businessName}` : "";
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : "Hello,";
  const ask = input.kind === "invoice" ? "View and pay it here" : "View it here";
  const signOff = input.businessName ? `Thank you,\n${input.businessName}` : "Thank you";
  return {
    subject: `${what[0].toUpperCase()}${what.slice(1)} #${input.number}${from}`,
    body: [
      greeting,
      `Your ${what} #${input.number}${from} is ready. The total is ${formatMoney(input.total)}.`,
      `${ask}: ${input.url}`,
      signOff,
    ].join("\n\n"),
  };
}
