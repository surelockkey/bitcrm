"use client";

import { Check, UserPlus } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUserMap } from "@/features/deals/hooks";
import type { InboxConversation } from "../api";
import { useUpdateConversation } from "../hooks";

/**
 * "Assign to ▸" inside the thread's "⋮" menu: hand a thread to a teammate.
 * Only shown to people who may list users — the directory is what the
 * picker is made of.
 */
export function AssignSubmenu({ conversation }: { conversation: InboxConversation }) {
  const { can, me } = usePermissions();
  const { users, map } = useUserMap();
  const update = useUpdateConversation();

  if (!can("users")) return null;

  const current = conversation.assignedUserId ? map.get(conversation.assignedUserId) : undefined;
  const currentName = current
    ? `${current.firstName} ${current.lastName}`.trim() || current.email
    : conversation.assignedUserId
      ? "Assigned"
      : undefined;

  const assign = (userId: string | null) =>
    update.mutate({
      id: conversation.id,
      patch: { assignedUserId: userId },
      label: userId ? "Conversation assigned" : "Conversation unassigned",
    });

  const sorted = [...users].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={update.isPending}>
        <UserPlus className="size-4" /> Assign to
        {currentName ? (
          <span className="ml-auto max-w-28 truncate pl-2 text-xs text-muted-foreground">{currentName}</span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-56">
        {me ? (
          <DropdownMenuItem onSelect={() => assign(me.id)}>
            <span className="flex-1">Me</span>
            {conversation.assignedUserId === me.id ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => assign(null)} disabled={!conversation.assignedUserId}>
          <span className="flex-1">Nobody</span>
          {!conversation.assignedUserId ? <Check className="size-3.5" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="max-h-64 overflow-y-auto">
          {sorted
            .filter((u) => u.id !== me?.id)
            .map((u) => (
              <DropdownMenuItem key={u.id} onSelect={() => assign(u.id)}>
                <span className="flex-1 truncate">{`${u.firstName} ${u.lastName}`.trim() || u.email}</span>
                {conversation.assignedUserId === u.id ? <Check className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
