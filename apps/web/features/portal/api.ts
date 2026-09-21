import type { PortalLink, PortalView } from "@bitcrm/types";
import { http } from "@/lib/api/http";

const BASE = "/billing/portal-links";

/**
 * The client-facing side (token-gated, no session) lives in its own app,
 * `apps/portal`, on its own domain. Only the staff calls are here.
 */

export const getPortalLink = (contactId: string): Promise<PortalLink | null> =>
  http.get<PortalLink | null>(`${BASE}/${contactId}`);

/** Creates or REGENERATES the link — the old URL stops working. */
export const createPortalLink = (contactId: string): Promise<PortalLink> =>
  http.post<PortalLink>(`${BASE}/${contactId}`);

/**
 * The link WITH its URL, without invalidating the one the client already has
 * (creates one when there is none). This is what "copy" and "send" use.
 */
export const getPortalLinkUrl = (contactId: string): Promise<PortalLink> =>
  http.post<PortalLink>(`${BASE}/${contactId}/url`);

export const deletePortalLink = (contactId: string): Promise<unknown> =>
  http.delete<unknown>(`${BASE}/${contactId}`);

export const getPortalPreview = (contactId: string): Promise<PortalView> =>
  http.get<PortalView>(`${BASE}/${contactId}/preview`);
