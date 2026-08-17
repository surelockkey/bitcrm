"use client";

import { useEffect, useState } from "react";
import { Check, Search, UserPlus } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { useContactByPhone, useCompanyMap } from "@/features/clients/hooks";
import { contactName, formatPhone, primaryPhone, searchContacts } from "@/features/clients/lib";
import { useContactMap } from "../hooks";

const MIN_QUERY = 3;
const MAX_SUGGESTIONS = 8;

/** New-client details typed into the picker, ready to be created with the job. */
export interface ClientDraft {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  /** An exact-phone match — adopt them instead of creating a duplicate. */
  existing: Contact | null;
}

/**
 * Workiz-style client lookup for the New Job page: one box that searches the
 * whole book from 3 characters — by name, phone (any formatting), email or
 * company. When nothing matches, the typed details become a draft new client
 * that is created together with the job (reported upward via onDraft).
 */
export function ClientPicker({
  hidden,
  contact,
  onResolved,
  onDraft,
  initialPhone,
}: {
  contact: Contact | null;
  hidden: boolean;
  onResolved: (c: Contact, created: boolean) => void;
  /** Fires with the current new-client draft, or null when there isn't one. */
  onDraft?: (draft: ClientDraft | null) => void;
  /** Seeded when the page was opened from a call with an unknown caller. */
  initialPhone?: string;
}) {
  const [query, setQuery] = useState(initialPhone ?? "");
  const [listOpen, setListOpen] = useState(true);
  const { map: contactMap } = useContactMap();
  const { map: companyMap } = useCompanyMap();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const trimmed = query.trim();
  const queryDigits = trimmed.replace(/\D/g, "");
  const queryIsPhone = queryDigits.length >= 7 && queryDigits.length >= trimmed.length - 6;

  // Exact-phone dupe guard for the create path (search itself is client-side).
  const newPhone = phone.trim() || (queryIsPhone ? trimmed : "");
  const dupe = useContactByPhone(newPhone, !contact && newPhone.length >= 7);
  const exactDupe = dupe.data ?? null;

  const companyNames = new Map(
    [...companyMap.values()].map((co) => [co.id, co.title] as [string, string]),
  );
  const matches =
    trimmed.length >= MIN_QUERY
      ? searchContacts([...contactMap.values()], trimmed, companyNames).slice(0, MAX_SUGGESTIONS)
      : [];

  const draftOpen = !contact && trimmed.length >= MIN_QUERY && matches.length === 0;
  const draftReady = draftOpen && Boolean(first.trim() && last.trim());

  useEffect(() => {
    onDraft?.(
      draftReady
        ? {
            firstName: first.trim(),
            lastName: last.trim(),
            phone: newPhone,
            email: email.trim(),
            existing: exactDupe,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report on data changes only
  }, [draftReady, first, last, newPhone, email, exactDupe]);

  // Kept mounted so a half-typed query survives glancing at the chosen client.
  if (hidden) return null;

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
            onChange={(e) => {
              setQuery(e.target.value);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
          />

          {/* Suggestions drop over the form as an overlay, not in the flow. */}
          {listOpen && trimmed.length >= MIN_QUERY && matches.length > 0 ? (
            <>
              <button
                type="button"
                aria-label="Close suggestions"
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setListOpen(false)}
              />
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border bg-popover shadow-md">
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
            </>
          ) : null}
        </div>
      </div>

      {trimmed.length < MIN_QUERY ? (
        <p className="text-xs text-muted-foreground">
          Type at least {MIN_QUERY} characters to search the client book.
        </p>
      ) : matches.length > 0 ? null : (
        <div className="rounded-lg border border-dashed p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <UserPlus className="size-4" /> No client found — fill in the details and they&apos;ll
            be created with the job
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input className="h-9" placeholder="First name" value={first} onChange={(e) => setFirst(e.target.value)} />
            <Input className="h-9" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PhoneInput
              value={phone || (queryIsPhone ? trimmed : "")}
              onChange={setPhone}
              placeholder="Phone…"
            />
            <Input className="h-9" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
          ) : null}
        </div>
      )}
    </div>
  );
}
