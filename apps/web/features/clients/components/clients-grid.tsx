"use client";

import { useMemo, type MouseEvent } from "react";
import type { ClientTag, Company, Contact } from "@bitcrm/types";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { Skeleton } from "@/components/ui/skeleton";
import { WzTableNoData } from "@/components/workiz/no-data";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { DEFAULT_TZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { useJobSourceName } from "@/features/job-sources/lib";
import { tagSolidClasses } from "@/features/client-tags/lib";
import {
  contactName,
  contactTypeLabel,
  extensionOf,
  formatPhoneWithExtension,
  primaryEmail,
  primaryPhone,
  sourceLabel,
} from "../lib";
import {
  CLIENT_FIELDS,
  clientAddressLine,
  clientSubline,
  formatClientCreated,
  type ClientFieldId,
} from "../clients-list";

/** Workiz pads its grid to this many rows (react-table `minRows`). */
const MIN_ROWS = 10;

/**
 * react-table as Workiz skins its Clients grid (pg_contacts_wz_01_default):
 * a 1px #ddd frame; header 41px #f7f7f7, 14px/500 #404040, 10px in, solid
 * #ccc rules; cells 20px all round, top-aligned, 14px/16px, a dotted #cfcfcf
 * rule between columns, clipped not wrapped; zebra rows, rgba(0,0,0,.05)
 * under the cursor. Separate borders, as the jobs grid, so the frame keeps
 * its rules.
 */
const FRAME = "relative border border-wz-frame";
const TABLE = "table-fixed w-full border-separate border-spacing-0";
const HEAD = "h-[42px] border-b border-r border-input bg-muted px-2.5 text-sm leading-[21px] font-medium text-wz-strong";
const CELL = "overflow-hidden border-r border-dotted border-table-border p-5 align-top text-sm leading-4 text-wz-strong";
const LINK = "text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline";

/** Starting widths: equal for Workiz's four, so at 1600px they split the row as Workiz's do. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(CLIENT_FIELDS.map((f) => [f.id, f.width] as const));
const LABEL = new Map(CLIENT_FIELDS.map((f) => [f.id, f.label] as const));

/**
 * The Clients list's grid: the columns the Visible fields panel saved, in its
 * order, a row per client, padded to ten rows; "No Records Found" over the
 * blank rows when there is nothing to show. A row opens the client — the
 * caller decides how (`onOpen` gets the click, for ⌘/Ctrl/middle → new tab).
 *
 * Kept apart from `ContactsTable`, which a company's roster still uses.
 */
export function ClientsGrid({
  contacts,
  columns,
  companyMap,
  tagMap,
  onOpen,
  zone = DEFAULT_TZ,
}: {
  contacts: Contact[];
  columns: readonly ClientFieldId[];
  companyMap: Map<string, Company>;
  tagMap: Map<string, ClientTag>;
  onOpen: (contact: Contact, e: MouseEvent) => void;
  /** The account's clock, for the Created column. */
  zone?: string;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("clients-list", COLUMN_DEFAULTS);
  const jobSourceName = useJobSourceName();

  const cell = (c: Contact, id: ClientFieldId) => {
    // The numbers come from the CONTACT only: crm strips them for a caller
    // without `contacts.view_numbers`, and that absence is the masking.
    const phone = primaryPhone(c);
    switch (id) {
      case "name": {
        const sub = clientSubline(c);
        const tags = (c.tagIds ?? []).map((t) => tagMap.get(t)).filter((t): t is ClientTag => Boolean(t));
        return (
          <>
            {/* pg_contacts_wz_01: h5 16px/24px #3b4b52, 0.2px. */}
            <div className="truncate text-base leading-6 tracking-[0.2px] text-foreground">{contactName(c)}</div>
            {sub?.kind === "email" ? (
              <div className="truncate text-xs leading-[18px] tracking-[0.4px] text-foreground">{sub.text}</div>
            ) : sub?.kind === "phone" ? (
              <a href={`tel:${sub.phone}`} onClick={(e) => e.stopPropagation()} className={cn("table", LINK)}>
                {formatPhoneWithExtension(sub.phone, extensionOf(c, sub.phone))}
              </a>
            ) : null}
            {tags.length ? (
              // pg_contacts_wz_12: 10px/14px 500 white capitals on the tag's colour, r2, 8px in.
              <div className="ml-2 flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span
                    key={t.id}
                    className={cn("rounded-[2px] px-1 text-[10px] leading-[14px] font-medium tracking-[0.4px] uppercase", tagSolidClasses(t.color))}
                  >
                    {t.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        );
      }
      case "address":
        return <div className="truncate">{clientAddressLine(c.addresses?.[0])}</div>;
      case "phone":
        if (phone) {
          return (
            // Workiz's Phone cell: an inline-block link, 16px tall, flush with the cell's top.
            <a href={`tel:${phone}`} onClick={(e) => e.stopPropagation()} className={cn("inline-block", LINK)}>
              {formatPhoneWithExtension(phone, extensionOf(c, phone))}
            </a>
          );
        }
        // Withheld from this viewer (no `contacts.view_numbers`) is not "none".
        return (
          <span className="block text-xs leading-4 tracking-[0.4px] text-wz-caption">
            {c.phonesMasked ? "Number hidden" : "No phone number"}
          </span>
        );
      case "created":
        return <div className="truncate">{formatClientCreated(c.createdAt, zone)}</div>;
      case "company": {
        const company = c.companyId ? companyMap.get(c.companyId) : undefined;
        return <div className="truncate">{company?.title ?? ""}</div>;
      }
      case "email":
        return <div className="truncate">{primaryEmail(c) ?? ""}</div>;
      case "source":
        return <div className="truncate">{c.sourceId ? jobSourceName(c.sourceId) : sourceLabel(c.source)}</div>;
      case "type":
        return <div className="truncate">{contactTypeLabel(c.type)}</div>;
    }
  };

  return (
    <div className={FRAME}>
      <Table className={TABLE} contained={false}>
        <colgroup>
          {columns.map((id) => (
            <col key={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {columns.map((id) => (
              <ResizableHead
                key={id}
                columnId={id}
                label={LABEL.get(id) ?? id}
                width={widthOf(id)}
                onResize={(px) => setWidth(id, px)}
                onReset={reset}
                className={HEAD}
              />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((c) => (
            <TableRow
              key={c.id}
              className="cursor-pointer border-0 hover:bg-black/5!"
              onClick={(e) => onOpen(c, e)}
              onAuxClick={(e) => {
                if (e.button === 1) onOpen(c, e);
              }}
            >
              {columns.map((id) => (
                <TableCell key={id} className={CELL}>
                  {cell(c, id)}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {Array.from({ length: Math.max(0, MIN_ROWS - contacts.length) }, (_, i) => (
            <TableRow key={`pad-${i}`} aria-hidden className="h-[57px] border-0 hover:bg-transparent">
              {columns.map((id) => (
                <TableCell key={id} className={CELL} />
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {contacts.length === 0 ? <WzTableNoData /> : null}
    </div>
  );
}

/** The grid while its first rows are on the way: the same header, widths and row height. */
export function ClientsGridSkeleton({ columns, rows = MIN_ROWS }: { columns: readonly ClientFieldId[]; rows?: number }) {
  const { widthOf } = useColumnWidths("clients-list", COLUMN_DEFAULTS);
  const cols = useMemo(() => [...columns], [columns]);
  return (
    <div className={FRAME} aria-busy role="status" aria-label="Loading clients">
      <Table className={TABLE} contained={false}>
        <colgroup>
          {cols.map((id) => (
            <col key={id} style={{ width: widthOf(id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            {cols.map((id) => (
              <th key={id} className={cn(HEAD, "truncate text-left last:border-r-0")}>
                {LABEL.get(id)}
              </th>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, i) => (
            <TableRow key={i} className="h-20 border-0 hover:bg-transparent">
              {cols.map((id) => (
                <TableCell key={id} className={CELL}>
                  <Skeleton className="h-4 w-2/3" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
