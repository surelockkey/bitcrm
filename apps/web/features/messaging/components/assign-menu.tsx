"use client";

import { Check, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUserMap } from "@/features/deals/hooks";
import type { InboxConversation } from "../api";
import { useUpdateConversation } from "../hooks";

/**
 * Hand a thread to a teammate. Only shown to people who may list users —
 * the directory is what the picker is made of.
 */
export function AssignMenu({ conversation }: { conversation: InboxConversation }) {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={update.isPending}>
          {update.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <UserPlus className="size-3.5" />}
          <span className="max-w-32 truncate">{currentName ?? "Assign"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
