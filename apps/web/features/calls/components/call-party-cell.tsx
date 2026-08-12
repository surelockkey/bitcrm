"use client";

import Link from "next/link";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/features/auth/use-permissions";
import { useRoles } from "@/features/users/hooks";
import { roleName } from "@/features/users/lib";
import { formatEndpoint, isClientEndpoint, type CallParty } from "../lib";

/**
 * One side of a call in the log. Whoever it is leads with their name and
 * carries the number underneath:
 *
 * - one of our people → name + role badge, linked to their profile
 * - a client → name, linked to the client record
 * - nobody we know → the number, with a shortcut to make it a client
 */
export function CallPartyCell({
  party,
  onAddClient,
}: {
  party: CallParty;
  /** Omitted where creating a client makes no sense (or isn't permitted). */
  onAddClient?: (phone: string) => void;
}) {
  const { can } = usePermissions();
  const { data: roles } = useRoles();

  // A `client:` leg is the user themselves, not a number worth repeating.
  const number = isClientEndpoint(party.number) ? undefined : party.number;

  if (party.kind === "unknown") {
    const canAdd = !!number && !!onAddClient && can("contacts", "create");
    return (
      <div className="flex flex-col items-start leading-tight">
        <span className="font-medium">{formatEndpoint(party.number)}</span>
        {canAdd ? (
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-brand"
            // The row opens the call — adding a client must win that click.
            onClick={(e) => {
              e.stopPropagation();
              onAddClient(number);
            }}
          >
            <UserPlus className="size-3" /> Add client
          </Button>
        ) : null}
      </div>
    );
  }

  const href =
    party.kind === "contact"
      ? `/contacts/${party.contactId}`
      : `/admin/users?user=${party.userId}`;
  const linkable =
    party.kind === "contact"
      ? can("contacts", "view")
      : !!party.userId && can("users", "view");

  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="flex items-center gap-1.5">
        {linkable ? (
          <Link
            href={href}
            onClick={(e) => e.stopPropagation()}
            className="font-medium underline-offset-2 hover:text-brand hover:underline"
          >
            {party.label}
          </Link>
        ) : (
          <span className="font-medium">{party.label}</span>
        )}
        {party.kind === "user" ? (
          <span className="rounded border border-brand/30 bg-brand/10 px-1 py-px text-[10px] font-medium uppercase tracking-wide text-brand">
            {party.roleId ? roleName(party.roleId, roles) : "Team"}
          </span>
        ) : null}
      </span>
      {number ? (
        <span className="text-xs text-muted-foreground">
          {formatEndpoint(number)}
        </span>
      ) : null}
    </div>
  );
}
