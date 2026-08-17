"use client";

import { useState } from "react";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import { ContactSource, ContactType } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { useContactByPhone, useCreateContact, useCompanyMap } from "@/features/clients/hooks";
import { contactName, formatPhone, primaryPhone, searchContacts } from "@/features/clients/lib";
import { useContactMap } from "../hooks";

const MIN_QUERY = 3;
const MAX_SUGGESTIONS = 8;

/**
 * Workiz-style client lookup for the New Job page: one box that searches the
 * whole book from 3 characters — by name, phone (any formatting), email or
 * company — with a create-new fallback when nothing matches.
 */
export function ClientPicker({
  hidden,
  contact,
  onResolved,
  initialPhone,
}: {
  contact: Contact | null;
  hidden: boolean;
  onResolved: (c: Contact, created: boolean) => void;
  /** Seeded when the page was opened from a call with an unknown caller. */
  initialPhone?: string;
}) {
  const [query, setQuery] = useState(initialPhone ?? "");
  const { map: contactMap } = useContactMap();
  const { map: companyMap } = useCompanyMap();
  const createContact = useCreateContact();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");

  const trimmed = query.trim();
  const queryDigits = trimmed.replace(/\D/g, "");
  const queryIsPhone = queryDigits.length >= 7 && queryDigits.length >= trimmed.length - 6;

  // Exact-phone dupe guard for the create path (search itself is client-side).
  const newPhone = phone.trim() || (queryIsPhone ? trimmed : "");
  const dupe = useContactByPhone(newPhone, !contact && newPhone.length >= 7);

  const companyNames = new Map(
    [...companyMap.values()].map((co) => [co.id, co.title] as [string, string]),
  );
  const matches =
    trimmed.length >= MIN_QUERY
      ? searchContacts([...contactMap.values()], trimmed, companyNames).slice(0, MAX_SUGGESTIONS)
      : [];

  // Kept mounted so a half-typed query survives glancing at the chosen client.
  if (hidden) return null;

  const exactDupe = dupe.data ?? null;
  const create = () => {
    if (!first.trim() || !last.trim()) return;
    createContact.mutate(
      {
        firstName: first,
        lastName: last,
        phones: newPhone ? [newPhone] : [],
        emails: [],
        addresses: [],
        type: ContactType.RESIDENTIAL,
        source: ContactSource.PHONE_CALL,
      },
      { onSuccess: (c) => onResolved(c, true) },
    );
  };

  const secondary = (c: Contact) => {
    const p = primaryPhone(c);
    const company = c.companyId ? companyNames.get(c.companyId) : undefined;
    return [p ? formatPhone(p) : null, c.emails[0], company].filter(Boolean).join(" · ");
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Find or add a client</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            autoFocus
            placeholder="Search by name, phone, email or company…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {trimmed.length < MIN_QUERY ? (
        <p className="text-xs text-muted-foreground">
          Type at least {MIN_QUERY} characters to search the client book.
        </p>
      ) : matches.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onResolved(c, false)}
              className="flex w-full flex-col items-start border-b px-3 py-2 text-left last:border-0 hover:bg-muted/50"
            >
              <span className="text-sm font-medium">{contactName(c)}</span>
              {secondary(c) ? (
                <span className="text-xs text-muted-foreground">{secondary(c)}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <UserPlus className="size-4" /> No client found — create one
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
            <Input className="h-9" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="mt-2">
            <PhoneInput
              value={phone || (queryIsPhone ? trimmed : "")}
              onChange={setPhone}
              placeholder="Phone…"
            />
          </div>
          {exactDupe ? (
            <div className="mt-2 rounded-lg border border-emerald-300 bg-emerald-50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <Check className="size-4" /> A client already has this phone
              </div>
              <div className="mt-0.5 text-sm font-medium">{contactName(exactDupe)}</div>
              <Button className="mt-2 w-full" variant="brand" size="sm" onClick={() => onResolved(exactDupe, false)}>
                Use this client →
              </Button>
            </div>
          ) : (
            <Button
              className="mt-3 w-full gap-1.5"
              variant="brand"
              size="sm"
              disabled={!first.trim() || !last.trim() || createContact.isPending}
              onClick={create}
            >
              {createContact.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Create client
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
