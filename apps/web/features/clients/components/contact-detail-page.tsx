"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronLeft, Mail, MapPin, Pencil, Phone, PhoneCall, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { ClientCallsLog } from "@/features/calls/components/client-calls-log";
import { CallClientButton } from "@/features/telephony/components/call-client-button";
import { FieldList } from "./field-list";
import { useContact, useCompanyMap, useDeleteContact } from "../hooks";
import {
  clientTypeLabel,
  contactName,
  extensionOf,
  formatAddress,
  formatPhoneWithExtension,
  initials,
  sourceLabel,
} from "../lib";
import { ContactTypeBadge } from "./client-badges";
import { ContactForm } from "./contact-form";
import { DeleteClientDialog } from "./delete-client-dialog";

export function ContactDetailPage({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: contact, isLoading } = useContact(contactId);
  const { map: companyMap } = useCompanyMap();
  const del = useDeleteContact();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isLoading || !contact) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  const company = contact.companyId ? companyMap.get(contact.companyId) : undefined;

  const remove = () =>
    del.mutate(contact.id, { onSuccess: () => router.push("/contacts") });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Link href="/contacts" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Contacts
        </Link>
        <span className="flex size-9 flex-none items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
          {initials(contact.firstName, contact.lastName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{contactName(contact)}</div>
          <div className="truncate text-xs text-muted-foreground">
            {contact.title ? `${contact.title} · ` : ""}
            {company ? <Link href={`/companies/${company.id}`} className="text-primary">{company.title}</Link> : "No company"}
          </div>
        </div>
        <ContactTypeBadge type={contact.type} />
        {!editing && can("contacts", "edit") ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
        {!editing && can("contacts", "delete") ? (
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="mx-auto max-w-2xl p-6">
            <ContactForm contact={contact} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <div className="grid gap-0 md:grid-cols-[1fr_300px]">
            <div className="space-y-5 p-6">
              {/* Formatted for reading — number then what to press once it
                  answers — but each row keeps its own raw number so the call
                  button dials what's on file. */}
              <FieldList
                label="Phones"
                icon={Phone}
                values={contact.phones}
                maskedCount={contact.phoneCount}
                format={(p) => formatPhoneWithExtension(p, extensionOf(contact, p))}
                primaryFirst
                action={(phone) => (
                  <CallClientButton to={phone} partyId={contact.id} />
                )}
              />
              <FieldList label="Emails" icon={Mail} values={contact.emails} />
              {contact.addresses?.length ? (
                <FieldList label="Addresses" icon={MapPin} values={contact.addresses.map(formatAddress)} />
              ) : null}
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Title" value={contact.title || "—"} />
                <Detail label="Source" value={sourceLabel(contact.source)} />
              </div>
              {contact.notes ? <Detail label="Notes" value={contact.notes} /> : null}

              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <PhoneCall className="size-3.5" /> Calls
                </div>
                <ClientCallsLog contactId={contact.id} />
              </div>
            </div>
            <div className="border-t p-6 md:border-l md:border-t-0">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Company</div>
              {company ? (
                <Link href={`/companies/${company.id}`} className="flex items-center gap-3 rounded-lg border p-3 hover:bg-accent">
                  <span className="flex size-8 flex-none items-center justify-center rounded-lg bg-primary/10 text-primary">
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
              <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Jobs</div>
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Their jobs appear here once Jobs ships.
              </div>
            </div>
          </div>
        )}
      </div>

      <DeleteClientDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={contactName(contact)}
        kind="contact"
        pending={del.isPending}
        onConfirm={remove}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
