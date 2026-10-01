"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { clientAddressRows, filterAddressRows } from "../client-page";
import { formatAddress } from "../lib";

/**
 * Workiz's "Select a service location": a new job for the client starts by
 * picking which of their addresses it is at — or none, to type a new one on
 * the job form. Each choice is a link into the job form with that address.
 */
export function ServiceLocationDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  // The client's service addresses, one row per distinct address, the service
  // address first. The billing address is where invoices go, not a job site.
  const rows = useMemo(() => clientAddressRows({ addresses: contact.addresses }, []), [contact.addresses]);
  const shown = useMemo(() => filterAddressRows(rows, query), [rows, query]);
  // The job form takes the address by its index in the client's list.
  const indexOf = (key: string) => contact.addresses.findIndex((a) => rows.find((r) => r.key === key)?.address === a);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Select a service location</DialogTitle>
          <DialogDescription className="sr-only">Which of the client&apos;s addresses the new job is at.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" aria-label="Search property" placeholder="Search property" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href={`/deals/new?contactId=${contact.id}&address=new`}>Create new location</Link>
          </Button>
        </div>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto border-t">
          {shown.length === 0 ? (
            <li className="px-5 py-6 text-center text-sm text-muted-foreground">No address matches.</li>
          ) : (
            shown.map((r) => {
              const i = indexOf(r.key);
              return (
                <li key={r.key} className="space-y-1.5 px-5 py-3">
                  <div className="font-medium">
                    {r.address.street}
                    {r.address.unit ? ` ${r.address.unit}` : ""}
                  </div>
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <MapPin className="size-3.5 shrink-0" aria-hidden />
                    {formatAddress(r.address)}
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/deals/new?contactId=${contact.id}&address=${i < 0 ? "new" : i}`}>Use this address</Link>
                  </Button>
                </li>
              );
            })
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
