"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronLeft, Mail, Pencil, Phone, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact, useCompanyMap, useDeleteContact } from "../hooks";
import { clientTypeLabel, contactName, formatPhone, initials, sourceLabel } from "../lib";
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
              <FieldList label="Phones" icon={Phone} values={contact.phones.map(formatPhone)} primaryFirst />
              <FieldList label="Emails" icon={Mail} values={contact.emails} />
              <div className="grid grid-cols-2 gap-4">
                <Detail label="Title" value={contact.title || "—"} />
                <Detail label="Source" value={sourceLabel(contact.source)} />
              </div>
              {contact.notes ? <Detail label="Notes" value={contact.notes} /> : null}
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
              <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Deals</div>
              <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                Their jobs appear here once Deals ships.
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

function FieldList({
  label,
  icon: Icon,
  values,
  primaryFirst = false,
}: {
  label: string;
  icon: typeof Phone;
  values: string[];
  primaryFirst?: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {values.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <div className="space-y-1">
          {values.map((v, i) => (
            <div key={`${v}-${i}`} className="flex items-center gap-2 text-sm">
              <Icon className="size-3.5 text-muted-foreground" />
              <span className="font-mono text-[13px]">{v}</span>
              {primaryFirst && i === 0 ? (
                <span className="rounded-full border border-green-500/40 px-1.5 text-[10px] text-green-600 dark:text-green-500">primary</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
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
