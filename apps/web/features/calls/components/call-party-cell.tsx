"use client";

import Link from "next/link";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatEndpoint, isClientEndpoint, type CallParty } from "../lib";

/**
 * One side of a call in the log: the user's name first (linked to their
 * profile when the viewer may open it), their number underneath. Sides with
 * no user of ours — a customer — are just the number.
 */
export function CallPartyCell({ party }: { party: CallParty }) {
  const { can } = usePermissions();

  if (!party.label) {
    return <span className="font-medium">{formatEndpoint(party.number)}</span>;
  }

  // A `client:` leg is the user themselves, not a number worth repeating.
  const number = isClientEndpoint(party.number) ? undefined : party.number;
  const linkable = !!party.userId && can("users", "view");

  return (
    <div className="flex flex-col leading-tight">
      {linkable ? (
        <Link
          href={`/admin/users?user=${party.userId}`}
          // The row itself opens the call — the name must win that click.
          onClick={(e) => e.stopPropagation()}
          className="w-fit font-medium underline-offset-2 hover:text-brand hover:underline"
        >
          {party.label}
        </Link>
      ) : (
        <span className="font-medium">{party.label}</span>
      )}
      {number ? (
        <span className="text-xs text-muted-foreground">
          {formatEndpoint(number)}
        </span>
      ) : null}
    </div>
  );
}
