"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Contact, InboxCounters, PaginatedResponse } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { fetchAllContacts } from "@/features/clients/api";
import { useCompanyMap } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { useUserMap } from "@/features/deals/hooks";
import * as api from "./api";
import type {
  ConversationListFilter,
  FeedMessage,
  InboxConversation,
  MessageTemplateBody,
  MessagingSettingsBody,
  PartyLookupKind,
  SendMessageBody,
  StartConversationBody,
  TextLookupParams,
  UpdateConversationPatch,
} from "./api";
import { applyConversation, applyMessage } from "./cache";
import {
  describeResendError,
  describeSendError,
  patchMessageInPages,
  removeMessageFromPages,
  replacePendingMessage,
  upsertMessageInPages,
  type PartyNames,
} from "./lib";
import { useMessagingStreamStore } from "./stream-store";

/** Design §7.6: without a live stream, counters every 30 s, the open feed every 10 s. */
const COUNTERS_FALLBACK_POLL_MS = 30_000;
const FEED_FALLBACK_POLL_MS = 10_000;

type FeedData = InfiniteData<PaginatedResponse<FeedMessage>, string | undefined>;

/* --------------------------------------------------------------- access */

/** The four gates the inbox UI cares about, resolved once per render. */
export function useMessagingAccess() {
  const { can, me, isLoading } = usePermissions();
  return {
    me,
    isLoading,
    canView: can("messages", "view"),
    canSend: can("messages", "send"),
    canManage: can("messages", "manage"),
    canViewTemplates: can("message_templates", "view"),
    canEditTemplates: can("message_templates", "edit"),
    canCreateTemplates: can("message_templates", "create"),
    canDeleteTemplates: can("message_templates", "delete"),
    canEditSettings: can("settings", "edit"),
  };
}

/* -------------------------------------------------------------- queries */

/**
 * The badge numbers. Pushed over the stream when it is up; polled every
 * 30 s when it is not (a dropped stream, a proxy that buffers).
 */
export function useInboxCounters() {
  const { canView } = useMessagingAccess();
  const connected = useMessagingStreamStore((s) => s.connected);
  return useQuery({
    queryKey: queryKeys.messaging.counters(),
    queryFn: api.getCounters,
    enabled: canView,
    refetchInterval: connected ? false : COUNTERS_FALLBACK_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useConversations(filter: ConversationListFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.messaging.conversationList(filter),
    queryFn: ({ pageParam }) => api.listConversations(filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled,
  });
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messaging.conversation(id ?? ""),
    queryFn: () => api.getConversation(id as string),
    enabled: !!id,
  });
}

/** The feed, newest first; `fetchNextPage` loads older. Polls while the stream is down. */
export function useConversationMessages(conversationId: string | undefined) {
  const connected = useMessagingStreamStore((s) => s.connected);
  return useInfiniteQuery({
    queryKey: queryKeys.messaging.messages(conversationId ?? ""),
    queryFn: ({ pageParam }) => api.listMessages(conversationId as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: !!conversationId,
    refetchInterval: connected ? false : FEED_FALLBACK_POLL_MS,
  });
}

export function useConversationByParty(kind: PartyLookupKind, id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messaging.conversationByParty(kind, id ?? ""),
    queryFn: () => api.getConversationByParty(kind, id as string),
    enabled: !!id,
  });
}

export function useConversationByJob(dealId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messaging.conversationByJob(dealId ?? ""),
    queryFn: () => api.getConversationByJob(dealId as string),
    enabled: !!dealId,
  });
}

/** Search box: a typed number resolves to the thread it would land on. */
export function useConversationByAddress(address: string | undefined) {
  return useQuery({
    queryKey: queryKeys.messaging.conversationByAddress(address ?? ""),
    queryFn: () => api.getConversationByAddress(address as string),
    enabled: !!address,
    staleTime: 60_000,
  });
}

export function useTextLookup(params: TextLookupParams | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.messaging.textLookup(params),
    queryFn: () => api.textLookup(params as TextLookupParams),
    enabled: enabled && !!params,
  });
}

export function useMessagesByJob(dealId: string | undefined) {
  const connected = useMessagingStreamStore((s) => s.connected);
  return useInfiniteQuery({
    queryKey: queryKeys.messaging.messagesByJob(dealId ?? ""),
    queryFn: ({ pageParam }) => api.listMessagesByJob(dealId as string, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: !!dealId,
    refetchInterval: connected ? false : FEED_FALLBACK_POLL_MS,
  });
}

export function useFlaggedMessages(enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.messaging.flaggedMessages(),
    queryFn: ({ pageParam }) => api.listFlaggedMessages(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled,
  });
}

/* ------------------------------------------------------------ names */

/**
 * Names for the other side of each conversation. The conversation stores
 * only `partyKind` / `partyId`; contacts and companies come from CRM (the
 * catalogs every client screen already caches) and employees from the
 * user directory, through the same restricted-viewer path the job roster
 * uses. Nothing is fetched the viewer may not list.
 */
export function usePartyNames(conversations: InboxConversation[]): PartyNames {
  const { can } = usePermissions();
  const userIds = useMemo(
    () =>
      conversations
        .filter((c) => c.partyKind === "user" && c.partyId)
        .map((c) => c.partyId as string),
    [conversations],
  );
  const needContacts = conversations.some((c) => c.partyKind === "contact");
  const needCompanies = conversations.some((c) => c.partyKind === "company");

  const contacts = useQuery({
    queryKey: queryKeys.contacts.list({ companyId: undefined }),
    queryFn: () => fetchAllContacts(),
    enabled: needContacts && can("contacts"),
    staleTime: 60_000,
  });
  const companies = useCompanyMap();
  const users = useUserMap(userIds);

  // Small maps rebuilt per render — the inbox holds at most a few pages.
  const contactMap = new Map<string, string>();
  for (const c of (contacts.data as Contact[] | undefined) ?? []) {
    contactMap.set(c.id, contactName(c));
  }
  const companyMap = new Map<string, string>();
  if (needCompanies) for (const [id, co] of companies.map) companyMap.set(id, co.title);
  const userMap = new Map<string, string>();
  for (const [id, u] of users.map) {
    userMap.set(id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || id);
  }
  return { contacts: contactMap, companies: companyMap, users: userMap };
}

/* ------------------------------------------------------------ mutations */

function useInvalidateCounters() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.messaging.counters() });
}

/**
 * Archive / restore, flag, mark unread, assign — one PATCH, one hook. The
 * server answers with the conversation as written, which goes straight
 * into every cached list and the detail entry; the stream will confirm.
 */
export function useUpdateConversation() {
  const qc = useQueryClient();
  const { me } = usePermissions();
  const invalidateCounters = useInvalidateCounters();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateConversationPatch; label?: string }) =>
      api.updateConversation(id, patch),
    onSuccess: (conversation, { label }) => {
      applyConversation(qc, conversation, me?.id);
      void invalidateCounters();
      if (label) toast.success(label);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Opening a thread marks it read for the team; quiet on failure. */
export function useMarkRead() {
  const qc = useQueryClient();
  const { me } = usePermissions();
  const invalidateCounters = useInvalidateCounters();
  return useMutation({
    mutationFn: ({ id, lastReadMessageSk }: { id: string; lastReadMessageSk?: string }) =>
      api.markConversationRead(id, lastReadMessageSk),
    onSuccess: (conversation, { id, lastReadMessageSk }) => {
      applyConversation(qc, conversation, me?.id);
      qc.setQueryData<api.ConversationDetail>(queryKeys.messaging.conversation(id), (prev) =>
        prev
          ? {
              ...prev,
              readMarker: {
                conversationId: id,
                userId: me?.id ?? "",
                lastReadAt: new Date().toISOString(),
                lastReadMessageSk,
              },
            }
          : prev,
      );
      void invalidateCounters();
    },
  });
}

export function useSetMessageFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { conversationId: string; messageId: string; createdAt: string; flagged: boolean }) =>
      api.setMessageFlag(args.conversationId, args.messageId, args.createdAt, args.flagged),
    onSuccess: (message, { flagged }) => {
      applyMessage(qc, message);
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.flaggedMessages() });
      toast.success(flagged ? "Message flagged" : "Flag removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export interface SendArgs {
  conversationId: string;
  body: SendMessageBody;
}

/**
 * Send in an existing thread. The line appears at once, keyed by its
 * `clientMessageId`, and is swapped for the server's message on the 202;
 * a refusal leaves it in the feed marked failed with the reason, so the
 * text is not lost.
 */
export function useSendMessage() {
  const qc = useQueryClient();
  const { me } = usePermissions();
  return useMutation({
    mutationFn: ({ conversationId, body }: SendArgs) => api.sendMessage(conversationId, body),
    onMutate: async ({ conversationId, body }) => {
      const key = queryKeys.messaging.messages(conversationId);
      await qc.cancelQueries({ queryKey: key });
      const now = new Date().toISOString();
      const pending: FeedMessage = {
        id: body.clientMessageId,
        conversationId,
        channel: body.channel,
        direction: "outbound",
        body: body.body,
        subject: body.subject,
        status: "queued",
        origin: "user",
        sentByUserId: me?.id,
        dealId: body.dealId,
        templateId: body.templateId,
        attachments: body.attachments?.map((a) => ({
          id: a.id,
          fileName: a.fileName,
          contentType: a.contentType,
          size: a.size,
          status: "pending" as const,
        })),
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<FeedData>(key, (prev) => {
        const base = prev ?? { pages: [], pageParams: [undefined] };
        return { ...base, pages: upsertMessageInPages(base.pages, pending) };
      });
    },
    onSuccess: (message, { conversationId, body }) => {
      qc.setQueryData<FeedData>(queryKeys.messaging.messages(conversationId), (prev) =>
        prev ? { ...prev, pages: replacePendingMessage(prev.pages, body.clientMessageId, message) } : prev,
      );
      if (message.dealId) applyMessage(qc, message);
      // The list row (preview, ordering) follows on the stream; nudge it in case.
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversationLists() });
    },
    onError: (e, { conversationId, body }) => {
      const status = e instanceof ApiError ? e.status : undefined;
      const reason = describeSendError(status, getApiErrorMessage(e));
      qc.setQueryData<FeedData>(queryKeys.messaging.messages(conversationId), (prev) =>
        prev
          ? {
              ...prev,
              pages: patchMessageInPages(prev.pages, body.clientMessageId, {
                status: "failed",
                errorMessage: reason,
              }),
            }
          : prev,
      );
      toast.error(reason);
    },
  });
}

export interface ResendArgs {
  conversationId: string;
  /** The failed line — its text, channel and attachments seed the new one. */
  message: FeedMessage;
  /** Idempotency key of the new send, minted by the caller as the composer does. */
  clientMessageId: string;
}

type FeedPages = PaginatedResponse<FeedMessage>[];

/** Rewrite one feed's pages; a feed never opened is left alone — it loads fresh on open. */
function patchFeed(qc: QueryClient, key: QueryKey, fn: (pages: FeedPages) => FeedPages): void {
  qc.setQueryData<FeedData>(key, (prev) => (prev ? { ...prev, pages: fn(prev.pages) } : prev));
}

/** Where a line is drawn: its thread's feed and, when it carries a job, the job tab's. */
function feedKeysOf(conversationId: string, dealId?: string) {
  return {
    thread: queryKeys.messaging.messages(conversationId),
    job: dealId ? queryKeys.messaging.messagesByJob(dealId) : undefined,
  };
}

/** Every resend is keyed alike, so any feed can ask which lines are in flight. */
const RESEND_MUTATION_KEY = ["messaging", "resend"] as const;

/**
 * Resend a failed line. The server makes a NEW outbound message (carrying
 * `resentFromMessageId`) and stamps the original with `resentAsMessageId`;
 * the original's `createdAt` goes along so its row is opened directly.
 * The new line appears at once as `queued`, keyed by `clientMessageId`,
 * and is swapped for the server's message on the 202 — dropping any copy
 * the stream delivered first, so the real id is drawn once; later
 * `message.upserted` frames then patch that id in place. A line that
 * carries a job gets the same treatment in the job tab's feed, so neither
 * view offers to resend it twice. A refusal removes the placeholder and
 * leaves the original as it was.
 */
export function useResendMessage() {
  const qc = useQueryClient();
  const { me } = usePermissions();
  return useMutation({
    mutationKey: RESEND_MUTATION_KEY,
    mutationFn: ({ conversationId, message, clientMessageId }: ResendArgs) =>
      api.resendMessage(conversationId, message.id, { clientMessageId, createdAt: message.createdAt }),
    onMutate: async ({ conversationId, message, clientMessageId }) => {
      const { thread, job } = feedKeysOf(conversationId, message.dealId);
      await qc.cancelQueries({ queryKey: thread });
      if (job) await qc.cancelQueries({ queryKey: job });
      const now = new Date().toISOString();
      const pending: FeedMessage = {
        id: clientMessageId,
        conversationId,
        channel: message.channel,
        direction: "outbound",
        body: message.body,
        subject: message.subject,
        to: message.to,
        toMasked: message.toMasked,
        status: "queued",
        origin: "user",
        sentByUserId: me?.id,
        dealId: message.dealId,
        templateId: message.templateId,
        attachments: message.attachments,
        resentFromMessageId: message.id,
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<FeedData>(thread, (prev) => {
        const base = prev ?? { pages: [], pageParams: [undefined] };
        return { ...base, pages: upsertMessageInPages(base.pages, pending) };
      });
      if (job) patchFeed(qc, job, (pages) => upsertMessageInPages(pages, pending));
    },
    onSuccess: (created, { conversationId, message, clientMessageId }) => {
      const { thread, job } = feedKeysOf(conversationId, message.dealId);
      const settle = (pages: FeedPages) =>
        patchMessageInPages(replacePendingMessage(pages, clientMessageId, created), message.id, {
          resentAsMessageId: created.id,
        });
      patchFeed(qc, thread, settle);
      if (job) {
        patchFeed(qc, job, settle);
        void qc.invalidateQueries({ queryKey: job });
      }
      // The list row (preview, ordering) follows on the stream; nudge it in case.
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.conversationLists() });
    },
    onError: (e, { conversationId, message, clientMessageId }) => {
      const status = e instanceof ApiError ? e.status : undefined;
      const { thread, job } = feedKeysOf(conversationId, message.dealId);
      const drop = (pages: FeedPages) => removeMessageFromPages(pages, clientMessageId);
      patchFeed(qc, thread, drop);
      if (job) patchFeed(qc, job, drop);
      toast.error(describeResendError(status, getApiErrorMessage(e)));
    },
  });
}

/**
 * The failed lines whose resend has not answered yet, from every mounted
 * feed: the same line waits in the inbox thread and in the job tab alike,
 * and one resend settling does not free another line's button.
 */
export function useResendingMessageIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: RESEND_MUTATION_KEY, status: "pending" },
    select: (m) => (m.state.variables as ResendArgs).message.id,
  });
  // `useMutationState` hands back the same array until its contents change.
  return useMemo(() => new Set(ids), [ids]);
}

/** First message to a party with no thread yet (contact or bare number). */
export function useSendToParty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StartConversationBody) => api.sendToParty(body),
    onSuccess: (message) => {
      applyMessage(qc, message);
      void qc.invalidateQueries({ queryKey: ["messaging", "conversations"] });
      void qc.invalidateQueries({ queryKey: queryKeys.messaging.textLookups() });
      if (message.dealId) {
        void qc.invalidateQueries({ queryKey: queryKeys.messaging.messagesByJob(message.dealId) });
      }
    },
    onError: (e) => {
      const status = e instanceof ApiError ? e.status : undefined;
      toast.error(describeSendError(status, getApiErrorMessage(e)));
    },
  });
}

/* ------------------------------------------------------------ templates */

export function useTemplates(params: api.TemplateListParams = {}, enabled = true) {
  return useQuery({
    queryKey: queryKeys.messaging.templates(params),
    queryFn: () => api.listTemplates(params),
    enabled,
    staleTime: 60_000,
  });
}

export function useShortCodes(enabled = true) {
  return useQuery({
    queryKey: queryKeys.messaging.shortCodes(),
    queryFn: api.listShortCodes,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useRenderTemplate() {
  return useMutation({
    mutationFn: ({ id, ctx }: { id: string; ctx: api.RenderTemplateContext }) =>
      api.renderTemplate(id, ctx),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function usePreviewTemplate() {
  return useMutation({
    mutationFn: (body: api.PreviewTemplateBody) => api.previewTemplate(body),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.messaging.templatesAll() });
}

export function useCreateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (body: MessageTemplateBody) => api.createTemplate(body),
    onSuccess: () => {
      void invalidate();
      toast.success("Template created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<MessageTemplateBody> }) =>
      api.updateTemplate(id, body),
    onSuccess: (_t, { body }) => {
      void invalidate();
      toast.success(body.active === true ? "Template restored" : "Template updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, permanent }: { id: string; permanent?: boolean }) =>
      api.deleteTemplate(id, permanent),
    onSuccess: (res) => {
      void invalidate();
      toast.success(res.deleted ? "Template deleted" : "Template archived");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/* ------------------------------------------------------------- settings */

export function useMessagingSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.messaging.settings(),
    queryFn: api.getMessagingSettings,
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateMessagingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MessagingSettingsBody) => api.updateMessagingSettings(body),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.messaging.settings(), settings);
      toast.success("Messaging settings saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Re-exported so components can type the badge without reaching into @bitcrm/types. */
export type { InboxCounters };
