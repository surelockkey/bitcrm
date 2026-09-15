"use client";

import Link from "next/link";
import { Building2, ExternalLink, Mail, MapPin, Phone, PhoneCall, UserRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientCallsLog } from "@/features/calls/components/client-calls-log";
import { useCompany, useContact } from "@/features/clients/hooks";
import { extensionOf, formatAddress, formatPhoneWithExtension } from "@/features/clients/lib";
import { useUserMap } from "@/features/deals/hooks";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { formatPhone } from "@/lib/phone";
import type { InboxConversation } from "../api";
import { conversationAddress, KIND_LABEL } from "../lib";

/**
 * The right pane: who is on the other end, how else to reach them, and
 * their call history — the Workiz "About" card, built from the records
 * the rest of BitCRM already shows.
 */
export function PartyCard({ conversation: c, title }: { conversation: InboxConversation; title: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</div>
      {c.partyKind === "contact" && c.partyId ? (
        <ContactCard contactId={c.partyId} />
      ) : c.partyKind === "company" && c.partyId ? (
        <CompanyCard companyId={c.partyId} />
      ) : c.partyKind === "user" && c.partyId ? (
        <UserCard userId={c.partyId} title={title} />
      ) : (
        <UnknownCard conversation={c} />
      )}
    </div>
  );
}

function Row({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

function ContactCard({ contactId }: { contactId: string }) {
  const { data: contact, isLoading } = useContact(contactId);
  if (isLoading || !contact) return <Skeleton className="h-32 w-full" />;
  return (
    <div className="space-y-4">
      <div>
        <div className="font-semibold">{`${contact.firstName} ${contact.lastName}`.trim()}</div>
        {contact.title ? <div className="text-xs text-muted-foreground">{contact.title}</div> : null}
      </div>
      {contact.phones.length ? (
        <Row icon={Phone}>
          {contact.phones.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2">
              <span className="truncate">{formatPhoneWithExtension(p, extensionOf(contact, p))}</span>
              <CallClientButton to={p} partyId={contact.id} />
            </div>
          ))}
        </Row>
      ) : contact.phonesMasked ? (
        <Row icon={Phone}>
          <span className="text-muted-foreground">
            {contact.phoneCount} number{contact.phoneCount === 1 ? "" : "s"}, hidden
          </span>
        </Row>
      ) : null}
      {contact.emails.length ? (
        <Row icon={Mail}>
          {contact.emails.map((e) => (
            <div key={e} className="truncate">{e}</div>
          ))}
        </Row>
      ) : null}
      {contact.addresses?.length ? (
        <Row icon={MapPin}>
          {contact.addresses.map((a, i) => (
            <div key={i} className="text-xs">{formatAddress(a)}</div>
          ))}
        </Row>
      ) : null}
      <Link
        href={`/contacts/${contact.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <ExternalLink className="size-3" /> Open contact
      </Link>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <PhoneCall className="size-3.5" /> Calls
        </div>
        <ClientCallsLog contactId={contact.id} />
      </div>
    </div>
  );
}

function CompanyCard({ companyId }: { companyId: string }) {
  const { data: company, isLoading } = useCompany(companyId);
  if (isLoading || !company) return <Skeleton className="h-32 w-full" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg border bg-muted text-muted-foreground">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold">{company.title}</div>
          {company.address ? <div className="truncate text-xs text-muted-foreground">{company.address}</div> : null}
        </div>
      </div>
      {company.phones.length ? (
        <Row icon={Phone}>
          {company.phones.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2">
              <span className="truncate">{formatPhoneWithExtension(p, extensionOf(company, p))}</span>
              <CallClientButton to={p} partyId={company.id} kind="company" />
            </div>
          ))}
        </Row>
      ) : null}
      {company.emails.length ? (
        <Row icon={Mail}>
          {company.emails.map((e) => (
            <div key={e} className="truncate">{e}</div>
          ))}
        </Row>
      ) : null}
      <Link
        href={`/companies/${company.id}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <ExternalLink className="size-3" /> Open company
      </Link>
      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <PhoneCall className="size-3.5" /> Calls
        </div>
        <ClientCallsLog contactId={company.id} kind="company" />
      </div>
    </div>
  );
}

function UserCard({ userId, title }: { userId: string; title: string }) {
  const { map } = useUserMap([userId]);
  const u = map.get(userId);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-brand/10 text-brand">
          <UserRound className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">Teammate{u?.department ? ` · ${u.department}` : ""}</div>
        </div>
      </div>
      {u?.email ? (
        <Row icon={Mail}>
          <div className="truncate">{u.email}</div>
        </Row>
      ) : null}
      <Link
        href={`/technicians/${userId}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
      >
        <ExternalLink className="size-3" /> Open profile
      </Link>
    </div>
  );
}

function UnknownCard({ conversation: c }: { conversation: InboxConversation }) {
  const phone = c.addresses?.phones?.[0];
  const address = conversationAddress(c);
  return (
    <div className="space-y-4">
      <div>
        <div className="font-semibold">{address ?? (c.phonesMasked ? "Unknown number" : KIND_LABEL[c.kind])}</div>
        <div className="text-xs text-muted-foreground">
          {c.kind === "unknown" ? "Nobody in CRM has this number yet." : KIND_LABEL[c.kind]}
        </div>
      </div>
      {phone ? (
        <Row icon={Phone}>
          <div className="flex items-center justify-between gap-2">
            <span>{formatPhone(phone)}</span>
            <CallClientButton to={phone} />
          </div>
        </Row>
      ) : null}
      {c.kind === "unknown" ? (
        <Link href="/contacts" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          <ExternalLink className="size-3" /> Find or create the contact
        </Link>
      ) : null}
    </div>
  );
}
