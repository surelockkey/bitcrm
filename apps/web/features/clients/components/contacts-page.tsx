"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContacts, useCompanyMap } from "../hooks";
import { searchContacts } from "../lib";
import { ContactsTable } from "./contacts-table";
import { ContactForm } from "./contact-form";

export function ContactsPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const contactsQuery = useContacts();
  const { map: companyMap } = useCompanyMap();

  const filtered = useMemo(
    () => searchContacts(contactsQuery.data ?? [], search),
    [contactsQuery.data, search],
  );

  if (!can("contacts", "view")) return <NoAccess entity="contacts" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People — residents and company representatives.
          </p>
        </div>
        {can("contacts", "create") ? (
          <Button variant="brand" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New contact
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search name, phone, email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "contact" : "contacts"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {contactsQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={search ? "No matching contacts" : "No contacts yet"}
            hint={search ? "Try a different search." : "Create your first contact to get started."}
          />
        ) : (
          <ContactsTable contacts={filtered} companyMap={companyMap} />
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New contact</DialogTitle></DialogHeader>
          <ContactForm
            onCancel={() => setCreating(false)}
            onDone={(c) => {
              setCreating(false);
              router.push(`/contacts/${c.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function NoAccess({ entity }: { entity: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">No access</h2>
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view {entity}.
      </p>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      <p className="max-w-xs text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
