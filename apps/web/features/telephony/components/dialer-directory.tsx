"use client";

import { Building2, Phone, User, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { formatPhone } from "@/lib/phone";
import { useContacts, useCompanies } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { listTransferTargets } from "../api";

interface Hit {
  kind: "contact" | "company" | "user";
  id: string;
  name: string;
  number: string;
  secondary?: string;
}

/** Digits only, so "404 555" matches "+1 404-555-1234". */
const digits = (v: string) => v.replace(/\D/g, "");

/**
 * Who you might be trying to reach, as you type. Everything with a phone
 * number — clients, company main lines, and teammates on their own phone —
 * matched by name or by number.
 *
 * Searched over the lists the app already keeps client-side, the same way the
 * client and job pickers work. That's fine at this size; a workspace with tens
 * of thousands of contacts would want this served by the search index, which
 * already tokenizes phone numbers for exactly this.
 */
export function DialerDirectory({
  query,
  onPick,
}: {
  query: string;
  onPick: (number: string) => void;
}) {
  const q = query.trim().toLowerCase();
  const qDigits = digits(query);
  const enabled = q.length >= 2;

  const { data: contacts } = useContacts();
  const { data: companies } = useCompanies();
  const { data: teammates } = useQuery({
    queryKey: queryKeys.telephony.transferTargets(),
    queryFn: listTransferTargets,
    staleTime: 60_000,
    enabled,
  });

  if (!enabled) return null;

  const matches = (name: string, number: string) =>
    name.toLowerCase().includes(q) ||
    (qDigits.length >= 3 && digits(number).includes(qDigits));

  const hits: Hit[] = [
    ...(contacts ?? []).flatMap((c) =>
      c.phones
        .filter((p) => matches(contactName(c), p))
        .map((p) => ({
          kind: "contact" as const,
          id: c.id,
          name: contactName(c),
          number: p,
        })),
    ),
    ...(companies ?? []).flatMap((c) =>
      (c.phones ?? [])
        .filter((p) => matches(c.title, p))
        .map((p) => ({
          kind: "company" as const,
          id: c.id,
          name: c.title,
          number: p,
        })),
    ),
    ...(teammates ?? [])
      .filter((t) => !!t.phone && matches(t.name, t.phone))
      .map((t) => ({
        kind: "user" as const,
        id: t.id,
        name: t.name,
        number: t.phone as string,
        secondary: "Teammate",
      })),
  ].slice(0, 8);

  if (hits.length === 0) {
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        Nobody matches — the number can still be dialled as typed.
      </p>
    );
  }

  const Icon = { contact: User, company: Building2, user: Users };

  return (
    <ul className="max-h-44 overflow-y-auto rounded-md border">
      {hits.map((hit) => {
        const HitIcon = Icon[hit.kind];
        return (
          <li key={`${hit.kind}-${hit.id}-${hit.number}`}>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => onPick(hit.number)}
            >
              <HitIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{hit.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {formatPhone(hit.number)}
                  {hit.secondary ? ` · ${hit.secondary}` : ""}
                </span>
              </span>
              <Phone className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
