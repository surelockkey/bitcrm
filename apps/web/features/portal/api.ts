import type { PortalInboxPage, PortalInboxShow, PortalLink, PortalView } from "@bitcrm/types";
import { inboxQueryString } from "@bitcrm/portal-ui";
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

/** The preview with the first page of the client's inbox (unsent documents included). */
export const getPortalPreview = (contactId: string): Promise<PortalView> =>
  http.get<PortalView>(`${BASE}/${contactId}/preview`);

/** One more page of the preview's inbox: Load more, Inbox Display, or a re-read. */
export const getPortalPreviewInbox = (
  contactId: string,
  q: { cursor?: string; limit?: number; show?: PortalInboxShow[] },
): Promise<PortalInboxPage> => http.get<PortalInboxPage>(`${BASE}/${contactId}/preview/inbox${inboxQueryString(q)}`);
