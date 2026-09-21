import type { PortalDocumentSummary, PortalView } from "@bitcrm/types";
import { PublicApiError, unwrapEnvelope } from "@bitcrm/portal-ui";
import { env } from "./env";

/**
 * GET against the public, token-gated portal routes. No credentials, no
 * cookies, no session handling: the token in the path is the whole
 * authorisation, and a failed call is only ever reported, never "fixed".
 */
export async function publicGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
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
