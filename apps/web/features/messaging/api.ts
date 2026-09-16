import type {
  Conversation,
  ConversationKind,
  ConversationReadMarker,
  InboxCounters,
  Message,
  MessageAttachmentType,
  MessageTemplate,
  MessageTemplateChannel,
  MessagingSettings,
  OptOut,
  OptOutChannel,
  OptOutStatus,
  PaginatedResponse,
  SendableMessageChannel,
  TeamChatCounters,
} from "@bitcrm/types";
import { apiFetchPaginated, http } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";

/** Every messaging route hangs off `${apiBaseUrl}/messaging`. */
export const BASE = "/messaging";

/* ------------------------------------------------------------------ types */

/** Inbox tabs — the four indexed views plus `mine` (assigned to the caller). */
export const INBOX_VIEWS = ["all", "unread", "flagged", "archived", "mine"] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export interface ConversationListFilter {
  view: InboxView;
  /** Only honoured with `view=all`. */
  kind?: ConversationKind;
  /** Only honoured with `view=all`. */
  categoryId?: string;
}

/** Party kinds `GET /conversations/by-party/:kind/:id` and the "Text" lookup accept. */
export type PartyLookupKind = "contact" | "company" | "user" | "group" | "address";
export type TextLookupPartyKind = "contact" | "company" | "user";

/**
 * A viewer without `contacts.view_numbers` gets client numbers withheld: the
 * conversation's `addresses.phones` comes back empty with `phonesMasked`, and
 * a message's `from` / `to` are dropped with the matching flag.
 */
export type InboxConversation = Conversation & { phonesMasked?: true };
export type FeedMessage = Message & {
  fromMasked?: true;
  toMasked?: true;
  contactAddressMasked?: true;
};
export type ConversationDetail = InboxConversation & {
  readMarker?: ConversationReadMarker;
};

/** `GET /conversations/text-lookup` — what a "Text" button needs before a thread exists. */
export interface TextLookupResult {
  conversation: InboxConversation | null;
  /** The address a message would go to; absent when masked (`addressMasked`) or unknown. */
  address?: string;
  addressMasked?: true;
  optOut: OptOut | null;
  canText: boolean;
}

export interface UpdateConversationPatch {
  state?: "open" | "archived";
  flagged?: boolean;
  unread?: boolean;
  categoryId?: string | null;
  assignedUserId?: string | null;
}

/** One upload the composer already PUT to S3 through `POST /attachments/presign`. */
export interface SendAttachment {
  id: string;
  fileName: string;
  contentType: MessageAttachmentType;
  size: number;
}

export interface SendMessageBody {
  /** Idempotency key minted by the composer (uuid). */
  clientMessageId: string;
  channel: SendableMessageChannel;
  body: string;
  subject?: string;
  /** E.164 company number the agent picked; omitted → the server's sender chain. */
  fromNumber?: string;
  toAddress?: string;
  dealId?: string;
  templateId?: string;
  attachments?: SendAttachment[];
}

/** `POST /messages` — exactly one of `contactId` / `phone` picks the party. */
export type StartConversationBody = SendMessageBody &
  ({ contactId: string; phone?: undefined } | { phone: string; contactId?: undefined });

export interface PresignedAttachmentUpload {
  id: string;
  s3Key: string;
  uploadUrl: string;
  /** Signed into the URL (SSE-KMS) — replayed verbatim on the PUT. */
  headers: Record<string, string>;
  expiresIn: number;
  fileName: string;
  contentType: string;
  size: number;
  maxBytes: number;
}

export type ShortCodeGroup = "client" | "job" | "technician" | "business" | "links" | "custom";
export interface ShortCode {
  code: string;
  group: ShortCodeGroup;
  description: string;
  example: string;
}

export interface RenderedTemplate {
  body: string;
  subject?: string;
  /** Codes that had no value (rendered empty, or kept visible on preview). */
  missing: string[];
}

export interface RenderTemplateContext {
  conversationId?: string;
  contactId?: string;
  dealId?: string;
  values?: Record<string, string>;
}

export interface PreviewTemplateBody extends RenderTemplateContext {
  body?: string;
  subject?: string;
  format?: "text" | "html";
  keepMissing?: boolean;
}

export interface TemplateListParams {
  channel?: "sms" | "email";
  includeInactive?: boolean;
}

export interface MessageTemplateBody {
  messageTemplateTitle: string;
  messageTemplate: string;
  messageSubjectTemplate?: string;
  messageFrom?: string;
  channel: MessageTemplateChannel;
  isDefault?: boolean;
  category?: string;
  active?: boolean;
}

export type MessagingSettingsBody = Partial<
  Omit<MessagingSettings, "updatedAt" | "updatedBy">
>;

/* --------------------------------------------------------- realtime frames */

export interface ConversationUpsertedEvent {
  type: "conversation.upserted";
  at: string;
  conversation: InboxConversation;
}
export interface MessageUpsertedEvent {
  type: "message.upserted";
  at: string;
  message: FeedMessage;
  conversation?: InboxConversation;
}
export interface CountersChangedEvent {
  type: "counters.changed";
  at: string;
  counters: InboxCounters;
}
export interface OptOutChangedEvent {
  type: "opt_out.changed";
  at: string;
  channel: OptOutChannel;
  address?: string;
  status: OptOutStatus;
  conversationId?: string;
}
/**
 * One member's team-chat badge (design §6) — written to that member's
 * stream only, after anything that moves it (a new in-app line, a read
 * marker, a membership change).
 */
export interface TeamCountersChangedEvent {
  type: "team_counters.changed";
  at: string;
  userId: string;
  counters: TeamChatCounters;
}
export type MessagingRealtimeEvent =
  | ConversationUpsertedEvent
  | MessageUpsertedEvent
  | CountersChangedEvent
  | OptOutChangedEvent
  | TeamCountersChangedEvent;

/** The SSE stream (opened with fetch so the Bearer header can be sent). */
export const MESSAGING_EVENTS_PATH = `${BASE}/events`;

/* ------------------------------------------------------------- helpers */

function paging(cursor?: string, limit = 50): string {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (cursor) qs.set("cursor", cursor);
  return qs.toString();
}

/**
 * The pointer lookups answer 404 until the party's first message. That is
 * "no conversation yet", not an error, so callers get `null`.
 */
async function nullOn404<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/* --------------------------------------------------------- conversations */

export function listConversations(
  filter: ConversationListFilter,
  cursor?: string,
): Promise<PaginatedResponse<InboxConversation>> {
  const qs = new URLSearchParams({ view: filter.view, limit: "50" });
  if (filter.view === "all" && filter.kind) qs.set("kind", filter.kind);
  if (filter.view === "all" && filter.categoryId) qs.set("categoryId", filter.categoryId);
  if (cursor) qs.set("cursor", cursor);
  return apiFetchPaginated<InboxConversation>(`${BASE}/conversations?${qs.toString()}`);
}

export const getConversation = (id: string): Promise<ConversationDetail> =>
  http.get<ConversationDetail>(`${BASE}/conversations/${id}`);

export const getCounters = (): Promise<InboxCounters> =>
  http.get<InboxCounters>(`${BASE}/conversations/counters`);

/** The caller's own team-chat badge — their thread and groups, against their read markers. */
export const getTeamCounters = (): Promise<TeamChatCounters> =>
  http.get<TeamChatCounters>(`${BASE}/team/counters`);

export const getConversationByParty = (
  kind: PartyLookupKind,
  id: string,
): Promise<InboxConversation | null> =>
  nullOn404(
    http.get<InboxConversation>(
      `${BASE}/conversations/by-party/${kind}/${encodeURIComponent(id)}`,
    ),
  );

export const getConversationByJob = (dealId: string): Promise<InboxConversation | null> =>
  nullOn404(http.get<InboxConversation>(`${BASE}/conversations/by-job/${dealId}`));

export const getConversationByAddress = (address: string): Promise<InboxConversation | null> =>
  nullOn404(
    http.get<InboxConversation>(
      `${BASE}/conversations/by-address?address=${encodeURIComponent(address)}`,
    ),
  );

export type TextLookupParams =
  | { partyKind: TextLookupPartyKind; partyId: string; address?: string }
  | { address: string; partyKind?: undefined; partyId?: undefined };

export function textLookup(params: TextLookupParams): Promise<TextLookupResult> {
  const qs = new URLSearchParams();
  if (params.partyKind && params.partyId) {
    qs.set("partyKind", params.partyKind);
    qs.set("partyId", params.partyId);
  }
  if (params.address) qs.set("address", params.address);
  return http.get<TextLookupResult>(`${BASE}/conversations/text-lookup?${qs.toString()}`);
}

/* -------------------------------------------------------------- messages */

/** Newest first; `cursor` loads older. */
export const listMessages = (
  conversationId: string,
  cursor?: string,
): Promise<PaginatedResponse<FeedMessage>> =>
  apiFetchPaginated<FeedMessage>(
    `${BASE}/conversations/${conversationId}/messages?${paging(cursor)}`,
  );

export const listMessagesByJob = (
  dealId: string,
  cursor?: string,
): Promise<PaginatedResponse<FeedMessage>> =>
  apiFetchPaginated<FeedMessage>(`${BASE}/messages/by-job/${dealId}?${paging(cursor)}`);

export const listFlaggedMessages = (cursor?: string): Promise<PaginatedResponse<FeedMessage>> =>
  apiFetchPaginated<FeedMessage>(`${BASE}/messages/flagged?${paging(cursor)}`);

/* ------------------------------------------------------------ management */

export const updateConversation = (
  id: string,
  patch: UpdateConversationPatch,
): Promise<InboxConversation> =>
  http.patch<InboxConversation>(`${BASE}/conversations/${id}`, patch);

export const markConversationRead = (
  id: string,
  lastReadMessageSk?: string,
): Promise<InboxConversation> =>
  http.post<InboxConversation>(
    `${BASE}/conversations/${id}/read`,
    lastReadMessageSk ? { lastReadMessageSk } : {},
  );

export const archiveConversation = (id: string): Promise<InboxConversation> =>
  http.post<InboxConversation>(`${BASE}/conversations/${id}/archive`);
export const unarchiveConversation = (id: string): Promise<InboxConversation> =>
  http.post<InboxConversation>(`${BASE}/conversations/${id}/unarchive`);
export const flagConversation = (id: string): Promise<InboxConversation> =>
  http.post<InboxConversation>(`${BASE}/conversations/${id}/flag`);
export const unflagConversation = (id: string): Promise<InboxConversation> =>
  http.delete<InboxConversation>(`${BASE}/conversations/${id}/flag`);
export const assignConversation = (id: string, userId: string): Promise<InboxConversation> =>
  http.post<InboxConversation>(`${BASE}/conversations/${id}/assign`, { userId });
export const unassignConversation = (id: string): Promise<InboxConversation> =>
  http.delete<InboxConversation>(`${BASE}/conversations/${id}/assign`);

export const setMessageFlag = (
  conversationId: string,
  messageId: string,
  createdAt: string,
  flagged: boolean,
): Promise<FeedMessage> =>
  http.patch<FeedMessage>(`${BASE}/conversations/${conversationId}/messages/${messageId}`, {
    createdAt,
    flagged,
  });

/* --------------------------------------------------------------- sending */

/** 202 with the message in `queued`; a repeated `clientMessageId` returns the first message. */
export const sendMessage = (conversationId: string, body: SendMessageBody): Promise<FeedMessage> =>
  http.post<FeedMessage>(`${BASE}/conversations/${conversationId}/messages`, body);

/** Opens the party's conversation when there is none yet, then sends. */
export const sendToParty = (body: StartConversationBody): Promise<FeedMessage> =>
  http.post<FeedMessage>(`${BASE}/messages`, body);

export interface ResendMessageBody {
  /** Idempotency key of the new send (uuid), as on a first send. */
  clientMessageId?: string;
  /**
   * The original's `createdAt` — the server opens its row directly with it;
   * without it, a line deeper than the thread's first 200 answers 404.
   */
  createdAt?: string;
}

/**
 * Resend a failed line: 202 with the NEW outbound message (it carries
 * `resentFromMessageId`; the original gets `resentAsMessageId`), 409 when
 * the original is not in a terminal failure status.
 */
export const resendMessage = (
  conversationId: string,
  messageId: string,
  body: ResendMessageBody = {},
): Promise<FeedMessage> =>
  http.post<FeedMessage>(
    `${BASE}/conversations/${conversationId}/messages/${messageId}/resend`,
    body,
  );

export const presignAttachment = (file: {
  fileName: string;
  contentType: string;
  size: number;
}): Promise<PresignedAttachmentUpload> =>
  http.post<PresignedAttachmentUpload>(`${BASE}/attachments/presign`, file);

export async function uploadAttachmentBytes(
  uploadUrl: string,
  file: File,
  headers: Record<string, string>,
): Promise<void> {
  // The URL is signed with SSE-KMS, so the headers the backend returns are
  // part of the signature and must be replayed — a bare PUT is a 403.
  const res = await fetch(uploadUrl, { method: "PUT", headers, body: file });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}

/** Presign, PUT, and hand back what `attachments[]` of the send needs. */
export async function uploadAttachment(file: File): Promise<SendAttachment> {
  const ticket = await presignAttachment({
    fileName: file.name,
    contentType: file.type,
    size: file.size,
  });
  await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
  return {
    id: ticket.id,
    fileName: file.name,
    contentType: file.type as MessageAttachmentType,
    size: file.size,
  };
}

/* ------------------------------------------------------------- templates */

export function listTemplates(params: TemplateListParams = {}): Promise<MessageTemplate[]> {
  const qs = new URLSearchParams();
  if (params.channel) qs.set("channel", params.channel);
  if (params.includeInactive) qs.set("includeInactive", "true");
  const s = qs.toString();
  return http.get<MessageTemplate[]>(`${BASE}/templates${s ? `?${s}` : ""}`);
}

export const getTemplate = (id: string): Promise<MessageTemplate> =>
  http.get<MessageTemplate>(`${BASE}/templates/${id}`);

export const createTemplate = (body: MessageTemplateBody): Promise<MessageTemplate> =>
  http.post<MessageTemplate>(`${BASE}/templates`, body);

export const updateTemplate = (
  id: string,
  body: Partial<MessageTemplateBody>,
): Promise<MessageTemplate> => http.put<MessageTemplate>(`${BASE}/templates/${id}`, body);

/** Archives; `permanent` deletes an already-archived template for good. */
export const deleteTemplate = (
  id: string,
  permanent = false,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete(`${BASE}/templates/${id}${permanent ? "?permanent=true" : ""}`);

export const renderTemplate = (
  id: string,
  ctx: RenderTemplateContext,
): Promise<RenderedTemplate> =>
  http.post<RenderedTemplate>(`${BASE}/templates/${id}/render`, ctx);

/** Renders an unsaved body (and, with `{{codes}}` in a free-typed draft, the composer's text). */
export const previewTemplate = (body: PreviewTemplateBody): Promise<RenderedTemplate> =>
  http.post<RenderedTemplate>(`${BASE}/templates/preview`, body);

export const listShortCodes = (): Promise<ShortCode[]> =>
  http.get<ShortCode[]>(`${BASE}/templates/short-codes`);

/* -------------------------------------------------------------- settings */

export const getMessagingSettings = (): Promise<MessagingSettings> =>
  http.get<MessagingSettings>(`${BASE}/settings`);

export const updateMessagingSettings = (
  body: MessagingSettingsBody,
): Promise<MessagingSettings> => http.put<MessagingSettings>(`${BASE}/settings`, body);

/* -------------------------------------------------------------- opt-outs */

export const lookupOptOuts = (address: string): Promise<OptOut[]> =>
  http.get<OptOut[]>(`${BASE}/opt-outs?address=${encodeURIComponent(address)}`);

/* ----------------------------------------------------------- automations */

/**
 * The two texts a technician sends themselves (design §10 M21; Workiz
 * `on_my_way_msg` / `late_msg`). The body is rendered server-side from the
 * workspace's template, so nothing here composes a message — the technician
 * taps once and the client hears from us.
 *
 * Both answer 202 with the queued message. 403 when the caller isn't on the
 * job's roster, 422 when the rule is switched off or the client has opted out.
 *
 * `clientMessageId` is the idempotency key, and the caller should always mint
 * one: without it the server falls back to a key made of the rule, the job,
 * the technician and a 15-minute bucket — which does NOT include how late the
 * technician said they were, so "late 15" at 10:02 and "late 45" at 10:07
 * would collapse into one text and the second would be silently dropped.
 */
export const sendOnMyWay = (body: {
  dealId: string;
  etaMinutes?: number;
  clientMessageId?: string;
}): Promise<Message> => http.post<Message>(`${BASE}/automations/on-my-way`, body);

export const sendRunningLate = (body: {
  dealId: string;
  minutes: number;
  clientMessageId?: string;
}): Promise<Message> => http.post<Message>(`${BASE}/automations/late`, body);
