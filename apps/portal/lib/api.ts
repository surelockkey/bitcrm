import type {
  OnlinePaymentMethod,
  PortalDocumentSummary,
  PortalPaymentOptions,
  PortalPaymentSession,
  PortalView,
} from "@bitcrm/types";
import { PublicApiError, unwrapEnvelope, type PortalPaymentStatus } from "@bitcrm/portal-ui";
import { env } from "./env";

/**
 * One call against the public, token-gated portal routes. No credentials, no
 * cookies, no session handling: the token in the path is the whole
 * authorisation, and a failed call is only ever reported, never "fixed".
 */
async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, { credentials: "omit", ...init });
  } catch {
    throw new PublicApiError(0, "Unable to reach the server. Please check your connection and try again.");
  }
  const body: unknown = await res.json().catch(() => null);
  const result = unwrapEnvelope<T>(body);
  if (!res.ok || !result.ok) {
    throw new PublicApiError(
      res.status,
      (!result.ok && result.message) || res.statusText || "Request failed",
      result.ok ? undefined : result.businessName,
    );
  }
  return result.data;
}

export const publicGet = <T,>(path: string): Promise<T> =>
  call<T>(path, { method: "GET", headers: { Accept: "application/json" } });

/**
 * The portal's only write. Used for one thing — starting a payment — so the
 * client secret comes back in the response body and never rides in a URL.
 */
export const publicPost = <T,>(path: string, body: unknown): Promise<T> =>
  call<T>(path, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const base = (token: string) => `/billing/public/portal/${encodeURIComponent(token)}`;
const docBase = (token: string, kind: PortalDocumentSummary["kind"], id: string) =>
  `${base(token)}/${kind}/${encodeURIComponent(id)}`;

export const getPortal = (token: string) => publicGet<PortalView>(base(token));

/** The document as a web page (what the portal shows first). */
export const getDocumentHtml = (token: string, doc: PortalDocumentSummary) =>
  publicGet<{ html: string }>(`${docBase(token, doc.kind, doc.id)}/html`);

/** A short-lived signed link to the PDF; `download` asks for an attachment. */
export const getDocumentPdfUrl = (token: string, doc: PortalDocumentSummary, download: boolean) =>
  publicGet<{ url: string }>(`${docBase(token, doc.kind, doc.id)}/pdf${download ? "?download=1" : ""}`);

/* ----------------------------------------------------------------- payments */

/** What this invoice will accept: balance, methods, minimums, any surcharge. */
export const getPaymentOptions = (token: string, invoiceId: string) =>
  publicGet<PortalPaymentOptions>(`${docBase(token, "invoice", invoiceId)}/payment-options`);

/**
 * Starts one attempt: the server creates the Stripe Checkout Session (and our
 * ledger row) and hands back the client secret plus the publishable key. The
 * amount is clamped server-side to `0 < x <= amountDue` — ours is a courtesy.
 */
export const startPayment = (token: string, invoiceId: string, body: { amount: number; method: OnlinePaymentMethod }) =>
  publicPost<PortalPaymentSession>(`${docBase(token, "invoice", invoiceId)}/pay`, body);

/** Where that payment got to. Polled a bounded number of times, never in a loop. */
export const getPaymentStatus = (token: string, paymentId: string) =>
  publicGet<PortalPaymentStatus>(`${base(token)}/payment/${encodeURIComponent(paymentId)}`);
