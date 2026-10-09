"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientCallsLog } from "@/features/calls/components/client-calls-log";
import { useCompany, useCompanyMap, useContact } from "@/features/clients/hooks";
import { extensionOf, formatAddress, formatPhoneWithExtension } from "@/features/clients/lib";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { useDealsPage, useDealsWindow, useUserMap } from "@/features/deals/hooks";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { useJobTypes } from "@/features/job-types/hooks";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatDate } from "@/features/users/lib";
import { formatPhone } from "@/lib/phone";
import type { InboxConversation } from "../api";
import { conversationAddress, KIND_LABEL } from "../lib";

/**
 * The thread's "Client info" panel (Workiz's person icon): who is on the
 * other end, how else to reach them, their company, their jobs, their calls,
 * and the quick actions (Text, Call, Open). Drawn in the Workiz client page's
 * language (pg_contact): capital 10px/14px #9ea6aa section labels, 14px/21px
 * ink values, sections split by 1px #dfe2e3 rules, secondary pills for the
 * actions. Built from the records the rest of BitCRM already shows.
 */
export function PartyCard({
  conversation: c,
  title,
  onText,
}: {
  conversation: InboxConversation;
  title: string;
  /** Focus the composer (inbox) or open one (cards); hidden when absent. */
  onText?: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6 pt-1 text-[14px] leading-[21px] text-foreground">
      {c.partyKind === "contact" && c.partyId ? (
        <ContactCard contactId={c.partyId} onText={onText} />
      ) : c.partyKind === "company" && c.partyId ? (
        <CompanyCard companyId={c.partyId} onText={onText} />
      ) : c.partyKind === "user" && c.partyId ? (
        <UserCard userId={c.partyId} title={title} onText={onText} />
      ) : (
        <UnknownCard conversation={c} onText={onText} />
      )}
    </div>
  );
}

/** One block of the panel: a Workiz capital label over its values, ruled off from the next. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="min-w-0 space-y-1">{children}</div>
    </section>
  );
}

/** Workiz's "CONTACT" label: 10px/14px 500 #9ea6aa capitals. */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[10px] leading-[14px] font-medium uppercase text-wz-outline">{children}</div>;
}

/** Text · Call · Open — the three things Workiz puts under the name. */
function QuickActions({
  onText,
  phone,
  partyId,
  kind,
  href,
  openLabel,
}: {
  onText?: () => void;
  phone?: string;
  partyId?: string;
  kind?: "contact" | "company";
  href?: string;
  openLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onText ? (
        <Button className="gap-1.5" onClick={onText}>
          <MessageSquare className="size-3.5" strokeWidth={1.5} /> Text
        </Button>
      ) : null}
      {phone ? (
        <span className="inline-flex h-8 items-center gap-1 rounded-pill border border-foreground pl-1 pr-4 text-[13px] leading-[19px] font-semibold">
          <CallClientButton to={phone} partyId={partyId} kind={kind} /> Call
        </span>
      ) : null}
      {href ? (
        <Button asChild variant="outline" className="gap-1.5">
          <Link href={href}>
            <ExternalLink className="size-3.5" strokeWidth={1.5} /> {openLabel}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

/** Whose jobs a card lists: a client's (an index), a teammate's open ones, or a company's open ones. */
type JobsSource = { contactId: string } | { companyId: string } | { techId: string };

/**
 * The jobs behind a party, newest first. A client's come straight off the
 * contact index; a teammate's and a company's are their open work — the
 * company narrowed on the page, as no index keys jobs by company yet.
 */
function JobsList({ source, newJobHref }: { source: JobsSource; newJobHref?: string }) {
  const { can } = usePermissions();
  const contactId = "contactId" in source ? source.contactId : undefined;
  const byContact = useDealsPage({ contactId, limit: 20 }, Boolean(contactId));
  const open = useDealsWindow(
    { techId: "techId" in source ? source.techId : undefined },
    { enabled: !contactId },
  );
  const isLoading = contactId ? byContact.isLoading : open.isLoading;
  const deals = contactId
    ? (byContact.data?.pages[0]?.data ?? [])
    : (open.data ?? []).filter((d) => ("companyId" in source ? d.companyId === source.companyId : true));
  const { data: jobTypes } = useJobTypes();
  if (!can("deals")) return null;
  const typeName = new Map((jobTypes ?? []).map((t) => [t.id, t.name] as const));
  const jobs = [...deals]
    .sort((a, b) => (b.scheduledDate ?? b.createdAt ?? "").localeCompare(a.scheduledDate ?? a.createdAt ?? ""))
    .slice(0, 8);

  return (
    <section className="border-t border-border pt-4">
      <div className="flex items-center justify-between">
        <SectionLabel>Jobs</SectionLabel>
        {newJobHref && can("deals", "create") ? (
          <Link href={newJobHref} className="mb-2 inline-flex items-center gap-0.5 text-[13px] leading-[19px] font-semibold text-brand hover:underline">
            <Plus className="size-3" /> New job
          </Link>
        ) : null}
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : jobs.length === 0 ? (
        <p className="text-[14px] leading-[21px] text-wz-outline-label">No jobs yet.</p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {jobs.map((d) => (
            <li key={d.id}>
              <Link href={`/deals/${d.id}`} className="block py-2 hover:bg-wz-secondary-hover">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] leading-[21px] font-semibold">#{d.dealNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] leading-[18px] text-wz-outline-label">
                    {typeName.get(d.jobTypeId) ?? ""}
                  </span>
                  <StageBadge status={d.superStatus} />
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[12px] leading-[18px] text-wz-outline-label">
                  <span>{d.scheduledDate ? formatDate(d.scheduledDate) : "Unscheduled"}</span>
                  <JobTagChips ids={d.tagIds} max={2} className="ml-auto" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The client's addresses: the first one, and the rest behind "Show all" —
 * Workiz keeps them in a closed "Addresses" fold on the client page, and a
 * company client can carry dozens.
 */
function AddressList({ addresses }: { addresses: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? addresses : addresses.slice(0, 1);
  return (
    <>
      {shown.map((a, i) => (
        <div key={i}>{a}</div>
      ))}
      {addresses.length > 1 ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="text-[13px] leading-[19px] font-semibold text-brand hover:underline"
        >
          {all ? "Show less" : `Show all ${addresses.length}`}
        </button>
      ) : null}
    </>
  );
}

function ContactCard({ contactId, onText }: { contactId: string; onText?: () => void }) {
  const { data: contact, isLoading } = useContact(contactId);
  const { map: companies } = useCompanyMap();
  if (isLoading || !contact) return <Skeleton className="h-32 w-full" />;
  const company = contact.companyId ? companies.get(contact.companyId) : undefined;
  const phone = contact.phones[0];
  return (
    <div className="space-y-4 pt-3">
      <div>
        <h3 className="text-[20px] leading-6 font-semibold text-foreground">{`${contact.firstName} ${contact.lastName}`.trim()}</h3>
        {contact.title ? <div className="text-[14px] leading-[21px] text-wz-outline-label">{contact.title}</div> : null}
      </div>
      <QuickActions onText={onText} phone={phone} partyId={contact.id} kind="contact" href={`/contacts/${contact.id}`} openLabel="Open client" />
      {contact.phones.length ? (
        <Row label="Contact">
          {contact.phones.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2">
              <span className="truncate">{formatPhoneWithExtension(p, extensionOf(contact, p))}</span>
              <CallClientButton to={p} partyId={contact.id} />
            </div>
          ))}
        </Row>
      ) : contact.phonesMasked ? (
        <Row label="Contact">
          <span className="text-wz-outline-label">
            {contact.phoneCount} number{contact.phoneCount === 1 ? "" : "s"}, hidden
          </span>
        </Row>
      ) : null}
      {contact.emails.length ? (
        <Row label="Email">
          {contact.emails.map((e) => (
            <div key={e} className="truncate">{e}</div>
          ))}
        </Row>
      ) : null}
      {contact.addresses?.length ? (
        <Row label={contact.addresses.length > 1 ? `Addresses (${contact.addresses.length})` : "Address"}>
          <AddressList addresses={contact.addresses.map(formatAddress)} />
        </Row>
      ) : null}
      {company ? (
        <Row label="Company">
          <Link href={`/companies/${company.id}`} className="truncate text-brand hover:underline">
            {company.title}
          </Link>
        </Row>
      ) : null}
      <JobsList source={{ contactId: contact.id }} newJobHref={`/deals/new?contactId=${encodeURIComponent(contact.id)}`} />
      <section className="border-t border-border pt-4">
        <SectionLabel>Calls</SectionLabel>
        <ClientCallsLog contactId={contact.id} />
      </section>
    </div>
  );
}

function CompanyCard({ companyId, onText }: { companyId: string; onText?: () => void }) {
  const { data: company, isLoading } = useCompany(companyId);
  if (isLoading || !company) return <Skeleton className="h-32 w-full" />;
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center gap-2">

        <div className="min-w-0">
          <h3 className="truncate text-[20px] leading-6 font-semibold text-foreground">{company.title}</h3>
          {company.address ? <div className="truncate text-[14px] leading-[21px] text-wz-outline-label">{company.address}</div> : null}
        </div>
      </div>
      <QuickActions onText={onText} phone={company.phones[0]} partyId={company.id} kind="company" href={`/companies/${company.id}`} openLabel="Open company" />
      {company.phones.length ? (
        <Row label="Contact">
          {company.phones.map((p) => (
            <div key={p} className="flex items-center justify-between gap-2">
              <span className="truncate">{formatPhoneWithExtension(p, extensionOf(company, p))}</span>
              <CallClientButton to={p} partyId={company.id} kind="company" />
            </div>
          ))}
        </Row>
      ) : null}
      {company.emails.length ? (
        <Row label="Email">
          {company.emails.map((e) => (
            <div key={e} className="truncate">{e}</div>
          ))}
        </Row>
      ) : null}
      <JobsList source={{ companyId: company.id }} />
      <section className="border-t border-border pt-4">
        <SectionLabel>Calls</SectionLabel>
        <ClientCallsLog contactId={company.id} kind="company" />
      </section>
    </div>
  );
}

function UserCard({ userId, title, onText }: { userId: string; title: string; onText?: () => void }) {
  const { map } = useUserMap([userId]);
  const u = map.get(userId);
  return (
    <div className="space-y-4 pt-3">
      <div className="flex items-center gap-2">

        <div className="min-w-0">
          <h3 className="truncate text-[20px] leading-6 font-semibold text-foreground">{title}</h3>
          <div className="text-[14px] leading-[21px] text-wz-outline-label">Teammate{u?.department ? ` · ${u.department}` : ""}</div>
        </div>
      </div>
      <QuickActions onText={onText} href={`/technicians/${userId}`} openLabel="Open profile" />
      {u?.email ? (
        <Row label="Email">
          <div className="truncate">{u.email}</div>
        </Row>
      ) : null}
      <JobsList source={{ techId: userId }} />
    </div>
  );
}

function UnknownCard({ conversation: c, onText }: { conversation: InboxConversation; onText?: () => void }) {
  const phone = c.addresses?.phones?.[0];
  const address = conversationAddress(c);
  return (
    <div className="space-y-4 pt-3">
      <div>
        <h3 className="text-[20px] leading-6 font-semibold text-foreground">{address ?? (c.phonesMasked ? "Unknown number" : KIND_LABEL[c.kind])}</h3>
        <div className="text-[14px] leading-[21px] text-wz-outline-label">
          {c.kind === "unknown" ? "Nobody in CRM has this number yet." : KIND_LABEL[c.kind]}
        </div>
      </div>
      <QuickActions onText={onText} phone={phone} openLabel="" />
      {phone ? (
        <Row label="Contact">
          <span>{formatPhone(phone)}</span>
        </Row>
      ) : null}
      {c.kind === "unknown" ? (
        <div className="flex flex-col gap-1.5">
          <Link href="/contacts" className="inline-flex items-center gap-1 text-[13px] leading-[19px] font-semibold text-brand hover:underline">
            <ExternalLink className="size-3" /> Find or create the contact
          </Link>
          {phone ? (
            <Link
              href={`/deals/new?phone=${encodeURIComponent(phone)}`}
              className="inline-flex items-center gap-1 text-[13px] leading-[19px] font-semibold text-brand hover:underline"
            >
              <Plus className="size-3" /> New job from this number
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
