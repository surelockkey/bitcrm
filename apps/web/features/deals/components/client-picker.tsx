"use client";

import { useEffect, useState } from "react";
import { Building2, Check, Search, UserPlus } from "lucide-react";
import { ClientType } from "@bitcrm/types";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import { MAX_EXTENSION_LENGTH, normalizeExtension } from "@/lib/phone";
import { useContactByPhone, useCompanyMap, useCreateCompany } from "@/features/clients/hooks";
import { CompanyPickerDialog } from "@/features/clients/components/company-picker-dialog";
import { contactName, formatPhone, primaryPhone, searchContacts } from "@/features/clients/lib";
import { useContactMap } from "../hooks";

const MIN_QUERY = 3;
const MAX_SUGGESTIONS = 8;

/** New-client details typed into the picker, ready to be created with the job. */
export interface ClientDraft {
  firstName: string;
  lastName: string;
  phone: string;
  /** What to press once that line answers, if anything. */
  phoneExt: string;
  email: string;
  /** Chosen or freshly-created company to file the new client under. */
  companyId?: string;
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
  const { map: companyMap, companies } = useCompanyMap();
  const createCompany = useCreateCompany();

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneExt, setPhoneExt] = useState("");
  const [email, setEmail] = useState("");
  const [companyId, setCompanyId] = useState<string | undefined>(undefined);
  const [companyTitle, setCompanyTitle] = useState("");
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);

  const selectCompany = (id: string) => {
    setCompanyId(id);
    setCompanyTitle(companyMap.get(id)?.title ?? "");
    setCompanyPickerOpen(false);
  };
  const createAndAssignCompany = (name: string) => {
    createCompany.mutate(
      { title: name, clientType: ClientType.COMMERCIAL, phones: [], emails: [] },
      {
        onSuccess: (co) => {
          setCompanyId(co.id);
          setCompanyTitle(co.title);
          setCompanyPickerOpen(false);
        },
      },
    );
  };

  const trimmed = query.trim();
  const queryDigits = trimmed.replace(/\D/g, "");
  const queryIsPhone = queryDigits.length >= 7 && queryDigits.length >= trimmed.length - 6;
  const queryIsEmail = trimmed.includes("@");

  // A name query prefills the create form: first word → first name, the rest →
  // last name. Phones and emails don't (they seed their own fields). The state
  // falls back to this so an untouched field still carries what was typed, and
  // any edit overrides it — same pattern as the phone field below.
  const queryName = queryIsPhone || queryIsEmail ? "" : trimmed;
  const [qFirst = "", ...qRest] = queryName.split(/\s+/).filter(Boolean);
  const qLast = qRest.join(" ");
  const effFirst = first || qFirst;
  const effLast = last || qLast;

  // Exact-phone dupe guard for the create path (search itself is client-side).
  const newPhone = phone.trim() || (queryIsPhone ? trimmed : "");
  const newEmail = email.trim() || (queryIsEmail ? trimmed : "");
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
  const draftReady = draftOpen && Boolean(effFirst.trim() && effLast.trim());

  useEffect(() => {
    onDraft?.(
      draftReady
        ? {
            firstName: effFirst.trim(),
            lastName: effLast.trim(),
            phone: newPhone,
            phoneExt,
            email: newEmail,
            companyId,
            existing: exactDupe,
          }
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report on data changes only
  }, [draftReady, effFirst, effLast, newPhone, phoneExt, newEmail, companyId, exactDupe]);

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
            <Input className="h-9" placeholder="First name" value={effFirst} onChange={(e) => setFirst(e.target.value)} />
            <Input className="h-9" placeholder="Last name" value={effLast} onChange={(e) => setLast(e.target.value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2">
              <PhoneInput
                className="flex-1"
                value={phone || (queryIsPhone ? trimmed : "")}
                onChange={setPhone}
                placeholder="Phone…"
                lockCountry
              />
              {/* What to press once the line answers — an office number often
                  needs one, and it's easier to catch now than later. */}
              <Input
                className="h-9 w-[4.5rem] flex-none px-2 text-center text-sm"
                placeholder="Ext."
                aria-label="Extension"
                inputMode="tel"
                maxLength={MAX_EXTENSION_LENGTH}
                value={phoneExt}
                onChange={(e) => setPhoneExt(normalizeExtension(e.target.value))}
              />
            </div>
            <Input className="h-9" type="email" placeholder="Email" value={newEmail} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="mt-2">
            <Button
              type="button"
              variant="outline"
              aria-label="Company"
              className="h-9 w-full justify-start gap-2 font-normal"
              onClick={() => setCompanyPickerOpen(true)}
            >
              <Building2 className="size-4 flex-none text-muted-foreground" />
              <span className={companyTitle ? "flex-1 truncate text-left" : "flex-1 truncate text-left text-muted-foreground"}>
                {companyTitle || "Select or create a company…"}
              </span>
            </Button>
          </div>
          <CompanyPickerDialog
            open={companyPickerOpen}
            onOpenChange={setCompanyPickerOpen}
            companies={companies}
            onSelect={selectCompany}
            onCreate={createAndAssignCompany}
          />
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
