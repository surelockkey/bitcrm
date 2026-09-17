import type { PortalLink, PortalView } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import { portalPdfPath } from "./lib";
import { publicGet } from "./public-http";

const BASE = "/billing/portal-links";

/* ------------------------------------------------ staff (authenticated) */

export const getPortalLink = (contactId: string): Promise<PortalLink | null> =>
  http.get<PortalLink | null>(`${BASE}/${contactId}`);

/** Creates or regenerates the link — the only response that carries the URL. */
export const createPortalLink = (contactId: string): Promise<PortalLink> =>
  http.post<PortalLink>(`${BASE}/${contactId}`);

export const deletePortalLink = (contactId: string): Promise<unknown> =>
  http.delete<unknown>(`${BASE}/${contactId}`);

export const getPortalPreview = (contactId: string): Promise<PortalView> =>
  http.get<PortalView>(`${BASE}/${contactId}/preview`);

/* ---------------------------------------------------- public (token) */

export const getPublicPortal = (token: string): Promise<PortalView> =>
  publicGet<PortalView>(`/billing/public/portal/${encodeURIComponent(token)}`);

export const getPublicPortalPdf = (
  token: string,
  kind: "invoice" | "estimate",
  id: string,
): Promise<{ url: string }> => publicGet<{ url: string }>(portalPdfPath(token, kind, id));
