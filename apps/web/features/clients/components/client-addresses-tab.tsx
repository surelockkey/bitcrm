"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/features/deals/lib";
import { filterAddressRows, type ClientAddressRow } from "../client-page";

/**
 * Workiz's Addresses tab: one line per distinct address with the jobs done
 * there and what they came to. The counts need every job, so opening the tab
 * asks for the rest of the list (`onNeedAll`) until it is all in hand.
 */
export function ClientAddressesTab({
  rows,
  money,
  complete,
  onNeedAll,
}: {
  rows: ClientAddressRow[];
  money: boolean;
  /** Every job of the client is loaded, so the counts are final. */
  complete: boolean;
  onNeedAll: () => void;
}) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!complete) onNeedAll();
  }, [complete, onNeedAll]);

  const shown = useMemo(() => filterAddressRows(rows, query), [rows, query]);

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" aria-label="Search addresses" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
        </div>
        <span className="text-xs text-muted-foreground">
          {shown.length} of {rows.length}
          {complete ? "" : " · counting jobs…"}
        </span>
      </div>
      <div className="border-y">
        <Table aria-label="Addresses">
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead>City</TableHead>
              <TableHead>State</TableHead>
              <TableHead>Zipcode</TableHead>
              <TableHead className="text-right">Jobs</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No addresses.
                </TableCell>
              </TableRow>
            ) : (
              shown.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {r.address.street}
                        {r.address.unit ? ` ${r.address.unit}` : ""}
                      </span>
                      {r.isService ? <Badge variant="secondary">Service</Badge> : null}
                      {r.isBilling ? <Badge variant="outline">Billing</Badge> : null}
                    </span>
                  </TableCell>
                  <TableCell>{r.address.city}</TableCell>
                  <TableCell>{r.address.state}</TableCell>
                  <TableCell>{r.address.zip}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.jobs}</TableCell>
                  <TableCell className="text-right tabular-nums">{money ? formatMoney(r.total) : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
