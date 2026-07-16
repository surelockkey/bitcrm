"use client";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Company } from "@bitcrm/types";
import { formatPhone, primaryPhone } from "../lib";
import { ClientTypeBadge } from "./client-badges";

export function CompaniesTable({ companies }: { companies: Company[] }) {
  const router = useRouter();

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Company</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Location</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((c) => {
            const phone = primaryPhone(c);
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/companies/${c.id}`)}
              >
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 flex-none items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                      <Building2 className="size-4" />
                    </span>
                    <div className="truncate font-medium">{c.title}</div>
                  </div>
                </TableCell>
                <TableCell><ClientTypeBadge type={c.clientType} /></TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {phone ? formatPhone(phone) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-primary">
                  {c.website || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
                  {c.address || "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
