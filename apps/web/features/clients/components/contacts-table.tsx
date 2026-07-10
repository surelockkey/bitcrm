"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Company, Contact } from "@bitcrm/types";
import { contactName, formatPhone, initials, primaryEmail, primaryPhone } from "../lib";
import { ContactTypeBadge, SourceLabel } from "./client-badges";

export function ContactsTable({
  contacts,
  companyMap,
}: {
  contacts: Contact[];
  companyMap: Map<string, Company>;
}) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => {
            const company = c.companyId ? companyMap.get(c.companyId) : undefined;
            const phone = primaryPhone(c);
            const email = primaryEmail(c);
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/contacts/${c.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 flex-none items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {initials(c.firstName, c.lastName)}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{contactName(c)}</div>
                      {c.title ? (
                        <div className="truncate text-xs text-muted-foreground">{c.title}</div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {company ? (
                    <span className="text-primary">{company.title}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {phone ? (
                    <span>
                      {formatPhone(phone)}
                      {c.phones.length > 1 ? (
                        <span className="ml-1 rounded-full border px-1 text-[10px] text-muted-foreground">
                          +{c.phones.length - 1}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                  {email ? (
                    <span>
                      {email}
                      {c.emails.length > 1 ? (
                        <span className="ml-1 rounded-full border px-1 text-[10px]">
                          +{c.emails.length - 1}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell><ContactTypeBadge type={c.type} /></TableCell>
                <TableCell><SourceLabel source={c.source} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
