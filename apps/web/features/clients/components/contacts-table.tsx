"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import type { Company, Contact } from "@bitcrm/types";
import {
  contactName,
  extensionOf,
  formatPhoneWithExtension,
  initials,
  primaryEmail,
  primaryPhone,
} from "../lib";
import { ContactTypeBadge, SourceLabel } from "./client-badges";

/**
 * Every column, in order, with the width it starts at.
 *
 * One list, read by both the `<colgroup>` and the headers — a width written
 * twice is a width that drifts. The table is `table-fixed`, so this is the
 * only thing that decides how wide a column is: a long email is clipped
 * rather than allowed to widen its column and shove the rest of the row
 * sideways.
 */
const COLUMNS = [
  { id: "name", label: "Name", width: 260 },
  { id: "company", label: "Company", width: 200 },
  { id: "phone", label: "Phone", width: 170 },
  { id: "email", label: "Email", width: 240 },
  { id: "type", label: "Type", width: 150 },
  { id: "source", label: "Source", width: 150 },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width] as const),
);

export function ContactsTable({
  contacts,
  companyMap,
}: {
  contacts: Contact[];
  companyMap: Map<string, Company>;
}) {
  const router = useRouter();
  // Remembered per table, like the page size is per list.
  const { widthOf, setWidth, reset } = useColumnWidths("contacts", COLUMN_DEFAULTS);

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
          {contacts.map((c) => {
            const company = c.companyId ? companyMap.get(c.companyId) : undefined;
            // The number and the email come from the CONTACT and nowhere
            // else: crm hands back a contact already stripped of its numbers
            // to a caller without `contacts.view_numbers`, and masking IS
            // that absence. Any other source would hand them back.
            const phone = primaryPhone(c);
            const email = primaryEmail(c);
            return (
              <TableRow
                key={c.id}
                className="cursor-pointer"
                onClick={() => router.push(`/contacts/${c.id}`)}
              >
                <TableCell className="overflow-hidden">
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
                <TableCell className="truncate text-sm">
                  {company ? (
                    <span className="text-primary">{company.title}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="truncate font-mono text-xs tabular-nums">
                  {phone ? (
                    <span>
                      {formatPhoneWithExtension(phone, extensionOf(c, phone))}
                      {c.phones.length > 1 ? (
                        <span className="ml-1 rounded-chip border px-1 text-[10px] text-muted-foreground">
                          +{c.phones.length - 1}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="truncate text-sm text-muted-foreground">
                  {email ? (
                    <span>
                      {email}
                      {c.emails.length > 1 ? (
                        <span className="ml-1 rounded-chip border px-1 text-[10px]">
                          +{c.emails.length - 1}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="overflow-hidden"><ContactTypeBadge type={c.type} /></TableCell>
                <TableCell className="overflow-hidden"><SourceLabel source={c.source} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
