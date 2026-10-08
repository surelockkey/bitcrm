"use client";

import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import type { Company } from "@bitcrm/types";
import { extensionOf, formatPhoneWithExtension, primaryPhone } from "../lib";
import { ClientTypeBadge } from "./client-badges";

/**
 * Every column, in order, with the width it starts at.
 *
 * One list, read by both the `<colgroup>` and the headers. The table is
 * `table-fixed`, so a long address is clipped instead of widening its column
 * and pushing the rest of the row sideways.
 */
const COLUMNS = [
  { id: "company", label: "Company", width: 280 },
  { id: "type", label: "Type", width: 150 },
  { id: "phone", label: "Phone", width: 170 },
  { id: "website", label: "Website", width: 220 },
  { id: "location", label: "Location", width: 260 },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width] as const),
);

export function CompaniesTable({ companies }: { companies: Company[] }) {
  const router = useRouter();
  const { widthOf, setWidth, reset } = useColumnWidths("companies", COLUMN_DEFAULTS);

  return (
    <div className="overflow-x-auto border">
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
              />
            ))}
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
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2.5">
                    <span className="flex size-8 flex-none items-center justify-center rounded-lg border bg-muted text-muted-foreground">
                      <Building2 className="size-4" />
                    </span>
                    <div className="truncate font-medium">{c.title}</div>
                  </div>
                </TableCell>
                <TableCell className="overflow-hidden"><ClientTypeBadge type={c.clientType} /></TableCell>
                <TableCell className="truncate font-mono text-xs tabular-nums">
                  {phone ? (
                    formatPhoneWithExtension(phone, extensionOf(c, phone))
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="truncate text-sm text-wz-link">
                  {c.website || <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="truncate text-sm text-muted-foreground">
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
