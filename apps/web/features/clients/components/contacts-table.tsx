"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Contact } from "@bitcrm/types";
import { localGridView, nextGridSort, WZ_GRID_PAGE_SIZES, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, type WzReportColumn, type WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { useJobSourceName } from "@/features/job-sources/lib";
import { contactName, contactTypeLabel, extensionOf, formatPhoneWithExtension, primaryEmail, primaryPhone, sourceLabel } from "../lib";

/** Workiz's blue tel link in a grid (pg_contacts_wz_01: 14px #6aa8ee). */
const LINK = "inline-block text-sm leading-4 whitespace-nowrap text-wz-link no-underline hover:underline";

/**
 * Every column, in order, with the width it starts at — one list, read by
 * both the `<colgroup>` and the headers. The grid is `table-fixed`, so this
 * alone decides a column's width: a long email is clipped instead of shoving
 * the rest of the row sideways.
 */
const COLUMNS = [
  { id: "name", label: "Name", width: 260 },
  { id: "phone", label: "Phone", width: 180 },
  { id: "email", label: "Email", width: 240 },
  { id: "type", label: "Type", width: 150 },
  { id: "source", label: "Ad Source", width: 170 },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(COLUMNS.map((c) => [c.id, c.width] as const));

/** Workiz lists people A→Z until a header says otherwise. */
const DEFAULT_SORT: WzGridSort = { id: "name", dir: "asc" };

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

/**
 * The people at a company — its representatives and anyone else linked to
 * it — as a Workiz grid (the client page's tabs, pg_contact_wz_269669_*):
 * the 71px strip (Search, the caller's `toolbar` pieces, the page size), then
 * react-table's grid — Name (the person's job title under it, as Workiz's
 * "Additional contacts" cards carry it), Phone (a blue tel link), Email,
 * Type, Ad Source — headers that sort and drag wider, ten rows a page,
 * "No Records Found", Workiz's pager. A row opens the person.
 *
 * The numbers come from the CONTACT and nowhere else: crm hands back a
 * contact already stripped of its numbers to a caller without
 * `contacts.view_numbers`, and masking IS that absence.
 */
export function ContactsTable({ contacts, toolbar }: { contacts: readonly Contact[]; toolbar?: ReactNode }) {
  const router = useRouter();
  const jobSourceName = useJobSourceName();
  // Remembered per table, like the page size is per list. The 1,000px they
  // start at fit the client page's main column beside a 208px menu; wider
  // screens spread the rest over them.
  const { widthOf, setWidth, reset } = useColumnWidths("company-contacts", COLUMN_DEFAULTS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);

  const source = useMemo(() => (c: Contact) => (c.sourceId ? jobSourceName(c.sourceId) : sourceLabel(c.source)), [jobSourceName]);

  // What the headers sort by and the Search looks in.
  const logic = useMemo<WzGridColumn<Contact>[]>(
    () => [
      { id: "name", label: "Name", render: () => null, sortValue: contactName, searchText: (c) => `${contactName(c)} ${c.title ?? ""}` },
      {
        id: "phone",
        label: "Phone",
        render: () => null,
        sortValue: (c) => digits(primaryPhone(c)) || undefined,
        searchText: (c) => c.phones.map(digits).join(" "),
      },
      { id: "email", label: "Email", render: () => null, sortValue: primaryEmail, searchText: (c) => c.emails.join(" ") },
      { id: "type", label: "Type", render: () => null, sortValue: (c) => contactTypeLabel(c.type) },
      { id: "source", label: "Ad Source", render: () => null, sortValue: source },
    ],
    [source],
  );
  const view = useMemo(() => localGridView(contacts, logic, { query, sort, page, size }), [contacts, logic, query, sort, page, size]);

  const columns = useMemo<WzReportColumn<Contact>[]>(() => {
    const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
    return [
      {
        id: "name",
        label: "Name",
        sortable: true,
        cell: (c) => (
          <>
            <div className="truncate text-base leading-6 tracking-[0.2px] text-foreground">{contactName(c)}</div>
            {c.title ? <div className="truncate text-xs leading-[18px] tracking-[0.4px] text-foreground">{c.title}</div> : null}
          </>
        ),
      },
      {
        id: "phone",
        label: "Phone",
        sortable: true,
        cell: (c) => {
          const phone = primaryPhone(c);
          if (phone) {
            return (
              <a href={`tel:${phone}`} onClick={stop} className={LINK}>
                {formatPhoneWithExtension(phone, extensionOf(c, phone))}
              </a>
            );
          }
          return (
            <span className="block text-xs leading-4 tracking-[0.4px] text-wz-caption">{c.phonesMasked ? "Number hidden" : "No phone number"}</span>
          );
        },
      },
      { id: "email", label: "Email", sortable: true, cell: (c) => <div className="truncate">{primaryEmail(c) ?? ""}</div> },
      { id: "type", label: "Type", sortable: true, cell: (c) => <div className="truncate">{contactTypeLabel(c.type)}</div> },
      { id: "source", label: "Ad Source", sortable: true, cell: (c) => <div className="truncate">{source(c)}</div> },
    ];
  }, [source]);

  const open = (c: Contact, e: WzRowOpenEvent) => {
    const url = `/contacts/${c.id}`;
    if (e.metaKey || e.ctrlKey || ("button" in e && e.button === 1)) window.open(url, "_blank", "noopener,noreferrer");
    else router.push(url);
  };

  return (
    <div data-slot="company-contacts" className="flex min-w-0 flex-col">
      <WzListToolbar>
        <WzSearchBox
          type="search"
          aria-label="Search contacts"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
        />
        {toolbar}
        <WzPageSizeSelect
          className="ml-auto"
          value={size}
          sizes={WZ_GRID_PAGE_SIZES}
          onChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      </WzListToolbar>
      <WzReportGrid
        aria-label="Contacts"
        className="shrink-0"
        columns={columns}
        rows={view.rows}
        rowKey={(c) => c.id}
        sort={sort ? { column: sort.id, dir: sort.dir } : null}
        onSort={(id) => {
          setSort((s) => nextGridSort(s, id));
          setPage(1);
        }}
        resize={{ widthOf, setWidth, reset }}
        onRowClick={open}
        stickyHeader={false}
        plainFiller
        footer={
          <WzPager
            pager={{
              page: view.page,
              from: view.from,
              to: view.to,
              total: view.total,
              totalPages: view.pages,
              canPrev: view.page > 1,
              canNext: view.page < view.pages,
              isFetching: false,
              prev: () => setPage(view.page - 1),
              next: () => setPage(view.page + 1),
            }}
          />
        }
      />
    </div>
  );
}
