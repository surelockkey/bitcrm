"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, ChevronRight, Mail, MapPin, MoreVertical, Pencil, Phone, Trash2 } from "lucide-react";
import type { Company, Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { ClientTagsField } from "@/features/client-tags/components/client-tags-field";
import { PortalLinkCard } from "@/features/portal/components/portal-link-card";
import { FieldList } from "./field-list";
import { ContactTypeBadge, TaxExemptBadge } from "./client-badges";
import { clientTypeLabel, contactName, extensionOf, formatAddress, formatPhoneWithExtension, sourceLabel } from "../lib";

/**
 * Workiz's left column of the client card: the name and company, how to
 * reach them, then the folding sections — Addresses (ONE service address and
 * ONE billing address; the rest live on the Addresses tab) and the company.
 */
export function ClientSummaryPanel({
  contact,
  company,
  canEdit,
  canDelete,
  canCreateTags,
  showPortal,
  onEdit,
  onDelete,
}: {
  contact: Contact;
  company?: Company;
  canEdit: boolean;
  canDelete: boolean;
  /** `client_tags.create`: the Add tag popup may make a new tag. */
  canCreateTags: boolean;
  showPortal: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const service = contact.addresses[0];
  const billing = contact.billingAddress;

  return (
    <aside aria-label="Client" className="flex flex-col border-b md:border-r md:border-b-0">
      <div className="flex items-start gap-2 px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg leading-tight font-semibold tracking-tight">{contactName(contact)}</h1>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {contact.title ? `${contact.title} · ` : ""}
            {company ? (
              <Link href={`/companies/${company.id}`} className="text-brand hover:underline">
                {company.title}
              </Link>
            ) : (
              "Residential"
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ContactTypeBadge type={contact.type} />
            {contact.taxExempt ? <TaxExemptBadge reason={contact.taxExemptReason} /> : null}
          </div>
        </div>
        {canEdit || canDelete ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Client actions">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit ? (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil className="size-4" /> Edit client
                </DropdownMenuItem>
              ) : null}
              {canEdit && canDelete ? <DropdownMenuSeparator /> : null}
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                  <Trash2 className="size-4" /> Delete client
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <div className="space-y-4 border-t px-5 py-4">
        <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Contact</div>
        <FieldList
          label="Phones"
          icon={Phone}
          values={contact.phones}
          maskedCount={contact.phoneCount}
          format={(p) => formatPhoneWithExtension(p, extensionOf(contact, p))}
          primaryFirst
          action={(phone) => <CallClientButton to={phone} partyId={contact.id} />}
        />
        <FieldList label="Emails" icon={Mail} values={contact.emails} />
        {/* Workiz's tags sit under the contact details: chips, then "+ Add tag". */}
        <ClientTagsField contactId={contact.id} tagIds={contact.tagIds} canEdit={canEdit} canCreate={canCreateTags} />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Source</div>
            {sourceLabel(contact.source)}
          </div>
          {contact.lastJobAt ? (
            <div>
              <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Last job</div>
              {contact.lastJobAt}
            </div>
          ) : null}
        </div>
      </div>

      <Section title="Addresses" defaultOpen>
        <AddressCard label="Service address" address={service ? formatAddress(service) : undefined} />
        <AddressCard label="Billing address" address={billing ? formatAddress(billing) : undefined} fallback="Same as the service address" />
      </Section>

      <Section title="Company" defaultOpen={false}>
        {company ? (
          <Link href={`/companies/${company.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent">
            <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Building2 className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{company.title}</div>
              <div className="text-xs text-muted-foreground">{clientTypeLabel(company.clientType)}</div>
            </div>
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">Residential — no company.</p>
        )}
      </Section>

      {showPortal ? (
        <div className="border-t px-5 py-4">
          <PortalLinkCard contactId={contact.id} />
        </div>
      ) : null}
    </aside>
  );
}

/** One of Workiz's folding sections ("> Addresses"). */
function Section({ title, defaultOpen, children }: { title: string; defaultOpen: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold hover:bg-muted/50"
      >
        {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
        {title}
      </button>
      {open ? <div className="space-y-3 px-5 pb-4">{children}</div> : null}
    </div>
  );
}

function AddressCard({ label, address, fallback }: { label: string; address?: string; fallback?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-medium">{label}</div>
      <div className={cn("mt-1 flex items-start gap-1.5 text-sm", !address && "text-muted-foreground")}>
        <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span>{address ?? fallback ?? "—"}</span>
      </div>
    </div>
  );
}
