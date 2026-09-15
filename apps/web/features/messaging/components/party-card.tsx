"use client";

import Link from "next/link";
import {
  Briefcase,
  Building2,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PhoneCall,
  Plus,
  UserRound,
} from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientCallsLog } from "@/features/calls/components/client-calls-log";
import { useCompany, useCompanyMap, useContact } from "@/features/clients/hooks";
import { extensionOf, formatAddress, formatPhoneWithExtension } from "@/features/clients/lib";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { useDeals, useUserMap } from "@/features/deals/hooks";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { useJobTypes } from "@/features/job-types/hooks";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatDate } from "@/features/users/lib";
import { formatPhone } from "@/lib/phone";
import type { InboxConversation } from "../api";
import { conversationAddress, KIND_LABEL } from "../lib";

/**
 * The right pane — Workiz's "About": who is on the other end, how else to
 * reach them, their company, their jobs, their calls, and the quick
 * actions (Text, Call, Open). Built from the records the rest of BitCRM
 * already shows.
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">About</div>
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

function Row({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

function SectionLabel({ icon: Icon, children }: { icon: typeof Phone; children: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="size-3.5" /> {children}
    </div>
  );
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
    <div className="flex flex-wrap items-center gap-1.5">
      {onText ? (
        <Button variant="brand" size="sm" className="gap-1.5" onClick={onText}>
          <MessageSquare className="size-3.5" /> Text
        </Button>
      ) : null}
      {phone ? (
        <span className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[0.8rem] font-medium">
          <CallClientButton to={phone} partyId={partyId} kind={kind} /> Call
        </span>
      ) : null}
      {href ? (
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href={href}>
            <ExternalLink className="size-3.5" /> {openLabel}
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The client's jobs, newest scheduled first. The deals list carries no
 * client filter server-side, so this reads the active set the Jobs page
 * already caches and narrows it here.
 */
function JobsList({ match, newJobHref }: { match: (d: Deal) => boolean; newJobHref?: string }) {
  const { can } = usePermissions();
  const { data: deals, isLoading } = useDeals();
  const { data: jobTypes } = useJobTypes();
  if (!can("deals")) return null;
  const typeName = new Map((jobTypes ?? []).map((t) => [t.id, t.name] as const));
  const jobs = (deals ?? [])
    .filter(match)
    .sort((a, b) => (b.scheduledDate ?? b.createdAt ?? "").localeCompare(a.scheduledDate ?? a.createdAt ?? ""))
    .slice(0, 8);

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel icon={Briefcase}>Jobs</SectionLabel>
        {newJobHref && can("deals", "create") ? (
          <Link href={newJobHref} className="mb-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-brand hover:underline">
            <Plus className="size-3" /> New job
          </Link>
        ) : null}
      </div>
      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">No jobs yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {jobs.map((d) => (
            <li key={d.id}>
              <Link href={`/deals/${d.id}`} className="block px-3 py-2 hover:bg-accent">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold">#{d.dealNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {typeName.get(d.jobTypeId) ?? ""}
                  </span>
                  <StageBadge status={d.superStatus} />
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{d.scheduledDate ? formatDate(d.scheduledDate) : "Unscheduled"}</span>
                  <JobTagChips ids={d.tagIds} max={2} className="ml-auto" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContactCard({ contactId, onText }: { contactId: string; onText?: () => void }) {
  const { data: contact, isLoading } = useContact(contactId);
  const { map: companies } = useCompanyMap();
  if (isLoading || !contact) return <Skeleton className="h-32 w-full" />;
  const company = contact.companyId ? companies.get(contact.companyId) : undefined;
  const phone = contact.phones[0];
  return (
    <div className="space-y-4">
      <div>
        <div className="font-semibold">{`${contact.firstName} ${contact.lastName}`.trim()}</div>
        {contact.title ? <div className="text-xs text-muted-foreground">{contact.title}</div> : null}
      </div>
      <QuickActions onText={onText} phone={phone} partyId={contact.id} kind="contact" href={`/contacts/${contact.id}`} openLabel="Open client" />
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
      {company ? (
        <Row icon={Building2}>
          <Link href={`/companies/${company.id}`} className="truncate text-brand hover:underline">
            {company.title}
          </Link>
        </Row>
      ) : null}
      <JobsList match={(d) => d.contactId === contact.id} newJobHref={`/deals/new?contactId=${encodeURIComponent(contact.id)}`} />
      <div>
        <SectionLabel icon={PhoneCall}>Calls</SectionLabel>
        <ClientCallsLog contactId={contact.id} />
      </div>
    </div>
  );
}

function CompanyCard({ companyId, onText }: { companyId: string; onText?: () => void }) {
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
      <QuickActions onText={onText} phone={company.phones[0]} partyId={company.id} kind="company" href={`/companies/${company.id}`} openLabel="Open company" />
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
      <JobsList match={(d) => d.companyId === company.id} />
      <div>
        <SectionLabel icon={PhoneCall}>Calls</SectionLabel>
        <ClientCallsLog contactId={company.id} kind="company" />
      </div>
    </div>
  );
}

function UserCard({ userId, title, onText }: { userId: string; title: string; onText?: () => void }) {
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
      <QuickActions onText={onText} href={`/technicians/${userId}`} openLabel="Open profile" />
      {u?.email ? (
        <Row icon={Mail}>
          <div className="truncate">{u.email}</div>
        </Row>
      ) : null}
      <JobsList match={(d) => d.assignedTechIds?.includes(userId)} />
    </div>
  );
}

function UnknownCard({ conversation: c, onText }: { conversation: InboxConversation; onText?: () => void }) {
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
      <QuickActions onText={onText} phone={phone} openLabel="" />
      {phone ? (
        <Row icon={Phone}>
          <span>{formatPhone(phone)}</span>
        </Row>
      ) : null}
      {c.kind === "unknown" ? (
        <div className="flex flex-col gap-1.5">
          <Link href="/contacts" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            <ExternalLink className="size-3" /> Find or create the contact
          </Link>
          {phone ? (
            <Link
              href={`/deals/new?phone=${encodeURIComponent(phone)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              <Plus className="size-3" /> New job from this number
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
