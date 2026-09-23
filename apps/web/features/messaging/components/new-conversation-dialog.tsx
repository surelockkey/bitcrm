"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, MessageSquarePlus, Phone, Search, UserRound } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCompanyMap, useContactSearch } from "@/features/clients/hooks";
import { contactName, searchContacts } from "@/features/clients/lib";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import type { SendMessageBody } from "../api";
import { useSendToParty } from "../hooks";
import { Composer } from "./composer";

const MIN_QUERY = 2;
const MAX_HITS = 8;

type Target = { kind: "contact"; contact: Contact } | { kind: "phone"; phone: string };

/**
 * Workiz's "New message": find a client by name, number or email — or
 * type a number nobody has yet — then write the first text. The server
 * opens (or reuses) the thread on send; the inbox jumps to it.
 */
export function NewConversationDialog({
  open,
  onOpenChange,
  onCreated,
  initialBody,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The conversation the first message landed in. */
  onCreated: (conversationId: string) => void;
  /** Text the composer opens with — a message being forwarded. */
  initialBody?: string;
}) {
  const { can } = usePermissions();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const debounced = useDebouncedValue(query, 200);
  const { map: companyMap } = useCompanyMap();
  const send = useSendToParty();

  // The search service finds the people; the same ranking orders them.
  const found = useContactSearch(can("contacts") ? debounced : "", MAX_HITS * 2);
  const contacts = found.data;
  const companyNames = useMemo(
    () => new Map([...companyMap.values()].map((co) => [co.id, co.title] as const)),
    [companyMap],
  );
  const hits = useMemo(() => {
    if (debounced.trim().length < MIN_QUERY || !can("contacts")) return [];
    return searchContacts(contacts, debounced, companyNames).slice(0, MAX_HITS);
  }, [contacts, debounced, companyNames, can]);
  const typedPhone = normalizePhone(debounced);

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setQuery("");
      setTarget(null);
    }
  };

  const sendFirst = async (body: SendMessageBody) => {
    if (!target) return;
    const message = await send.mutateAsync(
      target.kind === "contact" ? { ...body, contactId: target.contact.id } : { ...body, phone: target.phone },
    );
    close(false);
    onCreated(message.conversationId);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {target ? (
              <Button variant="ghost" size="icon-sm" onClick={() => setTarget(null)} aria-label="Pick someone else">
                <ChevronLeft className="size-4" />
              </Button>
            ) : (
              <MessageSquarePlus className="size-4 text-muted-foreground" />
            )}
            {target
              ? target.kind === "contact"
                ? `Text ${contactName(target.contact)}`
                : `Text ${formatPhone(target.phone)}`
              : "New message"}
          </DialogTitle>
          <DialogDescription>
            {target
              ? target.kind === "contact"
                ? formatPhone(target.contact.phones[0] ?? "") || "No number on file — the send will be refused."
                : "Nobody in CRM has this number; the thread opens as Unknown."
              : "Find a client, or type a number."}
          </DialogDescription>
        </DialogHeader>

        {target ? (
          <Composer
            contactId={target.kind === "contact" ? target.contact.id : undefined}
            onSend={sendFirst}
            autoFocus
            initialText={initialBody}
            placeholder="Type your message here..."
          />
        ) : (
          <div className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, phone or email…"
                aria-label="Find a client"
                className="h-9 pl-8"
              />
            </div>
            <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-lg border" aria-label="Matches">
              {hits.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setTarget({ kind: "contact", contact: c })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                      <UserRound className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{contactName(c)}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[c.phones[0] ? formatPhone(c.phones[0]) : c.phonesMasked ? "number hidden" : undefined, c.emails[0], c.companyId ? companyNames.get(c.companyId) : undefined]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {typedPhone && !hits.some((c) => c.phones.includes(typedPhone)) ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setTarget({ kind: "phone", phone: typedPhone })}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                      <Phone className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">Text {formatPhone(typedPhone)}</span>
                      <span className="block truncate text-xs text-muted-foreground">Not a client yet</span>
                    </span>
                  </button>
                </li>
              ) : null}
              {hits.length === 0 && !typedPhone ? (
                <li className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {debounced.trim().length < MIN_QUERY
                    ? "Start typing a name, a number or an email."
                    : "No client matches. A full phone number can be texted directly."}
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
