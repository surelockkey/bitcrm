"use client";

import type { InboxConversation } from "../api";
import { useSendMessage } from "../hooks";
import { Composer, type ComposerProps } from "./composer";

/** The composer bound to an existing thread: sends land in its feed at once. */
export function ThreadComposer({
  conversation,
  ...rest
}: Omit<ComposerProps, "onSend" | "conversation"> & { conversation: InboxConversation }) {
  const send = useSendMessage();
  return (
    <Composer
      conversation={conversation}
      onSend={(body) => send.mutateAsync({ conversationId: conversation.id, body })}
      {...rest}
    />
  );
}
