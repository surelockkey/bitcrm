"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { usePermissions } from "@/features/auth/use-permissions";
import { useRoles } from "@/features/users/hooks";
import { roleName } from "@/features/users/lib";
import { formatEndpoint, isClientEndpoint, type CallParty } from "../lib";

/** A click inside the row that must not also open the row. */
const keep = (e: MouseEvent) => e.stopPropagation();

/**
 * One side of a call in the log, as Workiz's From / To cells draw it
 * (callspage_wz_02_scroll1): the name 14px/16px `#607890`, the number 5px
 * under it at 12px — a client's in link blue (a `tel:` link, as Workiz's
 * phoneDialerLink is), our own side's in grey `#999`. A number nobody has
 * claimed is the first line itself, 14px link blue.
 *
 * Ours on top of Workiz's: one of our people carries their role, a company
 * says so, a call that reached a teammate's own phone says "personal", a
 * withheld number says "number hidden", and an unknown number offers "+ Add
 * client" while the row is under the cursor.
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

  if (party.kind === "unknown" || !party.name) {
    const canAdd = !!number && !!onAddClient && can("contacts", "create");
    return (
      <div className="flex min-w-0 flex-col items-start whitespace-nowrap">
        {/* A withheld number is not a missing one — and there is nothing to
            turn into a client, because the digits never reached this viewer. */}
        {!number && party.masked ? (
          <span className="text-sm leading-4 text-wz-caption">number hidden</span>
        ) : number ? (
          <a href={`tel:${number}`} onClick={keep} className="text-sm leading-4 text-wz-link no-underline hover:underline">
            {formatEndpoint(number)}
          </a>
        ) : (
          <span className="text-sm leading-4">{formatEndpoint(party.number)}</span>
        )}
        {canAdd ? (
          <button
            type="button"
            // The row opens the call — adding a client must win that click.
            onClick={(e) => {
              e.stopPropagation();
              onAddClient(number);
            }}
            className="mt-[5px] text-xs leading-4 font-medium text-wz-link opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 hover:underline"
          >
            + Add client
          </button>
        ) : null}
      </div>
    );
  }

  const isClient = party.kind === "contact" || party.kind === "company";
  const href =
    party.kind === "company"
      ? `/companies/${party.id}`
      : party.kind === "contact"
        ? `/contacts/${party.id}`
        : `/admin/users?user=${party.id}`;
  const linkable =
    !!party.id &&
    (isClient
      ? can(party.kind === "company" ? "companies" : "contacts", "view")
      : can("users", "view"));
  const name = "text-sm leading-4 text-wz-close-icon";
  // What we add to Workiz's line: one of ours carries their role, a company says so.
  const kind =
    party.kind === "company" ? "Company" : party.kind === "user" ? (party.roleId ? roleName(party.roleId, roles) : "Team") : null;
  const tag = kind ? <span className="text-wz-caption">{kind}</span> : null;
  const dot = <span className="text-wz-caption"> · </span>;

  return (
    <div className="flex min-w-0 flex-col items-start whitespace-nowrap">
      {linkable ? (
        <Link href={href} onClick={keep} className={`${name} no-underline hover:underline`}>
          {party.name}
        </Link>
      ) : (
        <span className={name}>{party.name}</span>
      )}
      <span className="mt-[5px] text-xs leading-4">
        {!number && party.masked ? (
          <span className="text-wz-caption">number hidden</span>
        ) : number ? (
          isClient ? (
            <a href={`tel:${number}`} onClick={keep} className="text-wz-link no-underline hover:underline">
              {formatEndpoint(number)}
            </a>
          ) : (
            <span className="text-wz-caption">
              {formatEndpoint(number)}
              {/* Their own phone, dialled by us — not their softphone. */}
              {party.personal ? <span className="ml-1">· personal</span> : null}
            </span>
          )
        ) : null}
        {tag && (number || party.masked) ? dot : null}
        {tag}
      </span>
    </div>
  );
}
