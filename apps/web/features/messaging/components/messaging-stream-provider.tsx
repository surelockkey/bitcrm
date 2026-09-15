"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useMessagingStream } from "../use-messaging-stream";

/**
 * Keeps the inbox stream open for anyone who may read messages or team
 * chat (the server checks the same pair). Renders nothing; lives in the
 * app shell next to the softphone.
 */
export function MessagingStreamProvider() {
  const { can, isLoading } = usePermissions();
  const enabled = !isLoading && (can("messages") || can("team_chat"));
  useMessagingStream(enabled);
  return null;
}
