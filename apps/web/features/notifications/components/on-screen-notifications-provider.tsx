"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { useMe } from "@/features/auth/use-me";
import type { ConversationListPage, MessageUpsertedEvent } from "@/features/messaging/api";
import { mergeIncludedNames } from "@/features/messaging/lib";
import { subscribeRealtimeEvents } from "@/features/messaging/realtime-bus";
import { useSoftphoneStore } from "@/features/telephony/softphone-store";
import { queryKeys } from "@/lib/query-keys";
import { browserNotificationPermission, decideOnScreenNotification, type OnScreenContext, type OnScreenNotice } from "../on-screen";
import { useOnScreenStore } from "../on-screen-store";

/** The stream's frame carries the roster and the mentions (`realtime-events.ts`); the web type predates them. */
type MessageFrame = MessageUpsertedEvent & { recipients?: string[]; mentions?: string[] };

/** The thread open in this tab (`/messages?c=`), if any. */
function openThreadId(): string | undefined {
  if (typeof window === "undefined" || window.location.pathname !== "/messages") return undefined;
  return new URLSearchParams(window.location.search).get("c") ?? undefined;
}

/** How many message ids are remembered, so a status change on a line already announced stays quiet. */
const SEEN_LIMIT = 500;

/**
 * Workiz's "On-screen notifications": while this is on, an inbound message
 * (not mine, not the thread I am looking at), an @mention and an incoming
 * call pop a browser notification; a click brings the app to the front on
 * that thread, or on the dialer. Fed by the messaging stream through the
 * realtime bus and by the softphone store; renders nothing.
 */
export function useOnScreenNotifications() {
  const router = useRouter();
  const qc = useQueryClient();
  const meId = useMe().data?.id;
  const enabled = useOnScreenStore((s) => s.enabled);
  const hydrate = useOnScreenStore((s) => s.hydrate);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const context = (): OnScreenContext => ({
      enabled: true,
      permission: browserNotificationPermission(),
      meId,
      focused: document.hasFocus() && document.visibilityState === "visible",
      openConversationId: openThreadId(),
    });

    const show = (notice: OnScreenNotice) => {
      let shown: Notification;
      try {
        shown = new Notification(notice.title, { body: notice.body, tag: notice.tag });
      } catch {
        return;
      }
      shown.onclick = () => {
        window.focus();
        if (notice.open.kind === "thread") router.push(`/messages?c=${encodeURIComponent(notice.open.conversationId)}`);
        else useSoftphoneStore.getState().setDialerOpen(true);
        shown.close();
      };
    };

    const seen = new Set<string>();
    const remember = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
      return true;
    };

    const partyName = (frame: MessageFrame): string | undefined => {
      const c = frame.conversation;
      if (!c) return undefined;
      // The inbox pages in the cache name their parties (`included`); nothing is fetched for a notification.
      const names = mergeIncludedNames(
        qc
          .getQueriesData<InfiniteData<ConversationListPage>>({ queryKey: queryKeys.messaging.conversationLists() })
          .flatMap(([, data]) => data?.pages ?? []),
      );
      const byParty = c.partyId
        ? (names.contacts.get(c.partyId) ?? names.companies.get(c.partyId) ?? names.users.get(c.partyId))
        : undefined;
      return byParty ?? c.name;
    };

    const offStream = subscribeRealtimeEvents((event) => {
      if (event.type !== "message.upserted") return;
      const frame = event as MessageFrame;
      if (!remember(frame.message.id)) return;
      const notice = decideOnScreenNotification(
        {
          kind: "message",
          message: frame.message,
          conversation: frame.conversation,
          partyName: partyName(frame),
          recipients: frame.recipients,
          mentions: frame.mentions ?? frame.message.mentions,
        },
        context(),
      );
      if (notice) show(notice);
    });

    const offPhone = useSoftphoneStore.subscribe((state, previous) => {
      if (state.callState !== "incoming" || previous.callState === "incoming" || !state.call) return;
      const notice = decideOnScreenNotification(
        { kind: "call", number: state.call.number, contactName: state.call.contactName },
        context(),
      );
      if (notice) show(notice);
    });

    return () => {
      offStream();
      offPhone();
    };
  }, [enabled, meId, router, qc]);
}

export function OnScreenNotificationsProvider() {
  useOnScreenNotifications();
  return null;
}
