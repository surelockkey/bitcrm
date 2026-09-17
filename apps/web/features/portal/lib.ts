import type { Address, PortalDocumentSummary, PortalView } from "@bitcrm/types";

/** Error from the unauthenticated portal client (never touches the session). */
export class PublicApiError extends Error {
  readonly status: number;
  /** Set when the API names the business behind a dead link. */
  readonly businessName?: string;

  constructor(status: number, message: string, businessName?: string) {
    super(message);
    this.name = "PublicApiError";
    this.status = status;
    this.businessName = businessName;
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | { ok: false; message: string | undefined; businessName?: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** `{ success, data }` → data; `{ success:false, error }` → its message. */
export function unwrapEnvelope<T>(body: unknown): Envelope<T> {
  if (isRecord(body) && body.success === true) return { ok: true, data: body.data as T };
  let message: string | undefined;
  let businessName: string | undefined;
  if (isRecord(body)) {
    const { error } = body;
    if (typeof body.message === "string") message = body.message;
    else if (typeof error === "string") message = error;
    else if (isRecord(error) && typeof error.message === "string") message = error.message;
    for (const src of [body, isRecord(error) ? error : null, isRecord(body.data) ? body.data : null]) {
      if (src && typeof src.businessName === "string") businessName = src.businessName;
    }
  }
  return businessName ? { ok: false, message, businessName } : { ok: false, message };
}

/** The token is unknown, revoked or expired (as opposed to a transient failure). */
export function isInvalidPortalError(e: unknown): boolean {
  return e instanceof PublicApiError && [400, 401, 403, 404, 410].includes(e.status);
}

export function portalGreeting(view: Pick<PortalView, "client" | "business">): string {
  const name = view.client.firstName?.trim() || "there";
  return `Hi ${name}, here are your documents from ${view.business.name}`;
}

export function businessAddressLine(a: Address | undefined): string {
  if (!a) return "";
  const stateZip = [a.state, a.zip].filter(Boolean).join(" ");
  return [a.street, a.unit, a.city, stateZip].filter(Boolean).join(", ");
}

export function telHref(phone: string): string {
  const plus = phone.trim().startsWith("+");
  return `tel:${plus ? "+" : ""}${phone.replace(/\D/g, "")}`;
}

export function portalPdfPath(token: string, kind: PortalDocumentSummary["kind"], id: string): string {
  return `/billing/public/portal/${encodeURIComponent(token)}/${kind}/${encodeURIComponent(id)}/pdf`;
}

export function documentKindLabel(kind: PortalDocumentSummary["kind"]): string {
  return kind === "invoice" ? "Invoice" : "Estimate";
}
