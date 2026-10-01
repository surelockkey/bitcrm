import type {
  EstimateWithItems,
  InvoiceView,
  OnlinePaymentMethod,
  PortalDepositOptions,
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
 * The portal's writes — a signature, a decision, a payment attempt — all go
 * in the body, so nothing sensitive ever rides in a URL.
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

/* ------------------------------------------------- the client's decisions */

export interface SignatureInput {
  /** PNG data URL from the signature canvas. */
  imageDataUrl: string;
  signedBy: string;
}

/** Approve an estimate = sign it (Workiz). The deposit, if any, is paid next. */
export const approveEstimate = (token: string, estimateId: string, body: SignatureInput) =>
  publicPost<EstimateWithItems>(`${docBase(token, "estimate", estimateId)}/approve`, body);

export const declineEstimate = (token: string, estimateId: string, body: { reason?: string }) =>
  publicPost<EstimateWithItems>(`${docBase(token, "estimate", estimateId)}/decline`, body);

/** Workiz "Request signature": the client signs the invoice before paying. */
export const signInvoice = (token: string, invoiceId: string, body: SignatureInput) =>
  publicPost<InvoiceView>(`${docBase(token, "invoice", invoiceId)}/sign`, body);

/* ------------------------------------------------------------ the deposit */

/** The estimate's deposit, in the shape the payment panel reads (it is one more thing to pay). */
export const getDepositOptions = async (token: string, estimateId: string): Promise<PortalPaymentOptions> => {
  const d = await publicGet<PortalDepositOptions>(`${docBase(token, "estimate", estimateId)}/deposit-options`);
  return {
    invoiceId: d.estimateId,
    number: d.number,
    amountDue: d.amountDue,
    amountPending: d.amountPending,
    currency: d.currency,
    methods: d.methods,
    allowPartial: d.allowPartial,
    bankMinimum: d.bankMinimum,
    surchargePercent: d.surchargePercent,
    surchargeLabel: d.surchargeLabel,
    tipsEnabled: false,
    tipPresets: [],
  };
};

/** Signature first: the server refuses a deposit on an estimate the client has not approved. */
export const startDeposit = (token: string, estimateId: string, body: { amount: number; method: OnlinePaymentMethod }) =>
  publicPost<PortalPaymentSession>(`${docBase(token, "estimate", estimateId)}/deposit/pay`, body);
