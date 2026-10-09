"use client";

import { useMemo, type ReactNode } from "react";
import type { Company } from "@bitcrm/types";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import type { WzGridSort } from "@/components/workiz/local-grid";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { DEFAULT_TZ } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { tagSolidClasses } from "@/features/client-tags/lib";
import { clientTypeLabel, extensionOf, formatPhoneWithExtension, primaryEmail, primaryPhone } from "../lib";
import { clientSubline, formatClientCreated } from "../clients-list";
import { COMPANY_FIELDS, websiteHref, type CompanyFieldId } from "../companies-list";

/** Workiz's blue tel link in a grid (pg_contacts_wz_01: 14px #6aa8ee). */
const LINK = "text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline";

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(COMPANY_FIELDS.map((f) => [f.id, f.width] as const));
const FIELD = new Map(COMPANY_FIELDS.map((f) => [f.id, f] as const));

/** A link inside a row answers its own click; the row would open the company too. */
const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

/** The PLATINUM chip under the name — Workiz's tag chip (10px/14px 500 white capitals, r2). */
export function PlatinumChip({ className }: { className?: string }) {
  return (
    <span className={cn("rounded-[2px] px-1 text-[10px] leading-[14px] font-medium tracking-[0.4px] uppercase", tagSolidClasses("blue"), className)}>
      Platinum
    </span>
  );
}

function cell(c: Company, id: CompanyFieldId, zone: string): ReactNode {
  // The numbers come from the COMPANY only: crm strips them for a caller
  // without `contacts.view_numbers`, and that absence is the masking.
  const phone = primaryPhone(c);
  switch (id) {
    case "name": {
      const sub = clientSubline(c);
      return (
        <>
          {/* pg_contacts_wz_01: h5 16px/24px ink, 0.2px. */}
          <div className="truncate text-base leading-6 tracking-[0.2px] text-foreground">{c.title}</div>
          {sub?.kind === "email" ? (
            <div className="truncate text-xs leading-[18px] tracking-[0.4px] text-foreground">{sub.text}</div>
          ) : sub?.kind === "phone" ? (
            <a href={`tel:${sub.phone}`} onClick={stop} className={cn("table", LINK)}>
              {formatPhoneWithExtension(sub.phone, extensionOf(c, sub.phone))}
            </a>
          ) : null}
          {c.isPlatinum ? (
            <div className="ml-2 flex">
              <PlatinumChip />
            </div>
          ) : null}
        </>
      );
    }
    case "type":
      return <div className="truncate">{clientTypeLabel(c.clientType)}</div>;
    case "address":
      return <div className="truncate">{c.address ?? ""}</div>;
    case "phone":
      if (phone) {
        return (
          <a href={`tel:${phone}`} onClick={stop} className={cn("inline-block", LINK)}>
            {formatPhoneWithExtension(phone, extensionOf(c, phone))}
          </a>
        );
      }
      // Withheld from this viewer (no `contacts.view_numbers`) is not "none".
      return (
        <span className="block text-xs leading-4 tracking-[0.4px] text-wz-caption">{c.phonesMasked ? "Number hidden" : "No phone number"}</span>
      );
    case "created":
      return <div className="truncate">{formatClientCreated(c.createdAt, zone)}</div>;
    case "website":
      return c.website ? (
        <a
          href={websiteHref(c.website)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={stop}
          className={cn("inline-block max-w-full truncate", LINK)}
        >
          {c.website}
        </a>
      ) : null;
    case "email":
      return <div className="truncate">{primaryEmail(c) ?? ""}</div>;
  }
}

/**
 * The Companies grid, drawn as Workiz's Clients grid (pg_contacts_wz_01):
 * the columns the Visible fields panel saved, in its order — Name (the email,
 * else the number, under it; the PLATINUM chip), Type, Address, Phone (a blue
 * tel link), Created on the account's clock — react-table's report grid
 * (`WzReportGrid`) with headers you drag wider and click to sort (not
 * Address, as Workiz), padded to ten rows, "No Records Found" when empty.
 * A row opens the company; the caller decides how (⌘/Ctrl/middle → new tab).
 */
export function CompaniesTable({
  companies,
  columns,
  sort,
  onSort,
  onOpen,
  loading = false,
  busy = false,
  footer,
  zone = DEFAULT_TZ,
}: {
  companies: readonly Company[];
  columns: readonly CompanyFieldId[];
  sort: WzGridSort | null;
  onSort: (column: CompanyFieldId) => void;
  onOpen: (company: Company, e: WzRowOpenEvent) => void;
  /** The companies are on their way: the header, blank rows and Workiz's dots. */
  loading?: boolean;
  /** A new search or filter is on its way over the rows on screen. */
  busy?: boolean;
  /** The pager, inside the frame under the rows. */
  footer?: ReactNode;
  /** The account's clock, for the Created column. */
  zone?: string;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("companies-list", COLUMN_DEFAULTS);
  const gridColumns = useMemo<WzReportColumn<Company>[]>(
    () =>
      columns.map((id) => ({
        id,
        label: FIELD.get(id)?.label ?? id,
        sortable: FIELD.get(id)?.sortable ?? false,
        cell: (c: Company) => cell(c, id, zone),
      })),
    [columns, zone],
  );

  return (
    <WzReportGrid
      aria-label="Companies"
      columns={gridColumns}
      rows={companies}
      rowKey={(c) => c.id}
      sort={sort ? { column: sort.id, dir: sort.dir } : null}
      onSort={(id) => onSort(id as CompanyFieldId)}
      resize={{ widthOf, setWidth, reset }}
      onRowClick={onOpen}
      loading={loading}
      busy={busy}
      stickyHeader={false}
      plainFiller
      footer={footer}
    />
  );
}
