"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, ChevronLeft, Mail, Pencil, Phone, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCompany, useCompanyContacts, useDeleteCompany } from "../hooks";
import { formatPhone } from "../lib";
import { ClientTypeBadge, PlatinumBadge } from "./client-badges";
import { CompanyForm } from "./company-form";
import { CompanyComplianceTab } from "./company-compliance-tab";
import { ContactForm } from "./contact-form";
import { ContactsTable } from "./contacts-table";
import { DeleteClientDialog } from "./delete-client-dialog";
import { EmptyState } from "./contacts-page";

export function CompanyDetailPage({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: company, isLoading } = useCompany(companyId);
  const contacts = useCompanyContacts(companyId);
  const del = useDeleteCompany();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  if (isLoading || !company) {
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  }

  const roster = contacts.data ?? [];
  const companyMap = new Map([[company.id, company]]);
  const remove = () => del.mutate(company.id, { onSuccess: () => router.push("/companies") });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Link href="/companies" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Companies
        </Link>
        <span className="flex size-9 flex-none items-center justify-center rounded-lg border bg-muted text-muted-foreground">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{company.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {company.address || "No address"}
            {company.website ? <> · <span className="text-primary">{company.website}</span></> : null}
          </div>
        </div>
        {company.isPlatinum ? <PlatinumBadge /> : null}
        <ClientTypeBadge type={company.clientType} />
        {!editing && can("companies", "edit") ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
        {!editing && can("companies", "delete") ? (
          <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="mx-auto max-w-2xl p-6">
            <CompanyForm company={company} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <Tabs defaultValue="overview" className="flex flex-col">
            <div className="border-b px-5">
              <TabsList variant="line" className="h-11">
                <TabsTrigger value="overview" className="px-2">Overview</TabsTrigger>
                <TabsTrigger value="contacts" className="px-2">Contacts · {roster.length}</TabsTrigger>
                <TabsTrigger value="compliance" className="px-2">Compliance</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-0 p-6">
              <div className="grid max-w-2xl gap-5">
                <FieldList label="Phones" icon={Phone} values={company.phones.map(formatPhone)} primaryFirst />
                <FieldList label="Emails" icon={Mail} values={company.emails} />
                <div className="grid grid-cols-2 gap-4">
                  <Detail label="Address" value={company.address || "—"} />
                  <Detail label="Website" value={company.website || "—"} />
                </div>
                {company.notes ? <Detail label="Notes" value={company.notes} /> : null}
              </div>
            </TabsContent>

            <TabsContent value="contacts" className="mt-0 p-6">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">People at {company.title}</div>
                {can("contacts", "create") ? (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddingContact(true)}>
                    <Plus className="size-3.5" /> Add contact
                  </Button>
                ) : null}
              </div>
              {contacts.isLoading ? (
                <Skeleton className="h-40 w-full" />
              ) : roster.length === 0 ? (
                <EmptyState
                  icon={<Building2 className="size-6" />}
                  title="No contacts yet"
                  hint="Add the people you work with at this company."
                />
              ) : (
                <ContactsTable contacts={roster} companyMap={companyMap} />
              )}
            </TabsContent>

            <TabsContent value="compliance" className="mt-0 p-6">
              <CompanyComplianceTab company={company} />
            </TabsContent>
          </Tabs>
        )}
      </div>

      <DeleteClientDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={company.title}
        kind="company"
        pending={del.isPending}
        onConfirm={remove}
      />

      <Dialog open={addingContact} onOpenChange={setAddingContact}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New contact · {company.title}</DialogTitle></DialogHeader>
          <ContactForm
            defaultCompanyId={company.id}
            onCancel={() => setAddingContact(false)}
            onDone={() => setAddingContact(false)}
          />
        </DialogContent>
      </Dialog>
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
