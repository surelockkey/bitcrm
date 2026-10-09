"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CalendarDays, Diamond, Globe, Mail, MapPin, Phone, Plus } from "lucide-react";
import type { Company } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WzFieldsPanel, type WzFieldOption } from "@/components/workiz/fields-panel";
import { WzFilterSelect, type WzFilterPick } from "@/components/workiz/filter-select";
import { WzKpiCard, WzKpiCardSkeleton } from "@/components/workiz/kpi-card";
import type { WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import type { WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePageSize } from "@/lib/paging/use-page-size";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useCompanies } from "../hooks";
import { useCompanyFieldsStore } from "../companies-fields-store";
import {
  COMPANY_DEFAULT_PAGE_SIZE,
  COMPANY_DEFAULT_SORT,
  COMPANY_FIELDS,
  COMPANY_PAGE_SIZES,
  companiesView,
  companyCardPicks,
  companyFilterGroups,
  companyKpis,
  selectedCompanyCard,
  type CompanyFieldIcon,
  type CompanyFieldId,
} from "../companies-list";
import { CompaniesTable } from "./companies-table";
import { CompanyForm } from "./company-form";
import { NoAccess } from "./contacts-page";

const NO_ROWS: Company[] = [];

/** The panel's glyphs (Workiz's `wfi-*`), by their nearest lucide twins. */
const FIELD_ICONS: Record<CompanyFieldIcon, React.ReactNode> = {
  company: <Building2 />,
  type: <Diamond />,
  location: <MapPin />,
  phone: <Phone />,
  calendar: <CalendarDays />,
  website: <Globe />,
  email: <Mail />,
};
const FIELD_OPTIONS: WzFieldOption[] = COMPANY_FIELDS.map((f) => ({ id: f.id, label: f.label, icon: FIELD_ICONS[f.icon] }));
const FILTER_GROUPS = companyFilterGroups();

/**
 * The Companies list. Workiz has no companies (its client's "Company name"
 * is a field), so the page is drawn as Workiz's Clients list
 * (`/root/clients/`, pg_contacts_wz_*) — the sibling of our `/contacts`:
 * four KPI cards (Companies / Commercial / Government / Platinum — the cards
 * are the filter, as on Workiz's Estimates and Invoices lists); "Filter
 * results" (TYPE, PLATINUM) with "+ Add Company" at the right; the grey
 * strip — Search, the page size, "Fields"; the grid — Name (email or number
 * under it, the PLATINUM chip) | Type | Address | Phone | Created, newest
 * first, headers that sort; Workiz's pager in its foot.
 *
 * Every company is in hand, so search, filters, order and pages answer at
 * once. One skeleton, then the whole page.
 */
export function CompaniesPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [picks, setPicks] = useState<WzFilterPick[]>([]);
  const [sort, setSort] = useState<WzGridSort | null>(COMPANY_DEFAULT_SORT);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize("companies", { sizes: COMPANY_PAGE_SIZES, fallback: COMPANY_DEFAULT_PAGE_SIZE });
  const columns = useCompanyFieldsStore((s) => s.used);
  const saveColumns = useCompanyFieldsStore((s) => s.save);

  const companiesQuery = useCompanies();
  // The cards, the rows, the footer and the button over them go up in one
  // frame — the count used to read "0 companies" until the rows came, and the
  // button turned up whenever the permissions did.
  const ready = usePageReady(!permsLoading && settled(companiesQuery));

  const all = companiesQuery.data ?? NO_ROWS;
  const kpis = useMemo(() => companyKpis(all), [all]);
  const view = useMemo(() => companiesView(all, { query: search, picks, sort, page, size: pageSize }), [all, search, picks, sort, page, pageSize]);
  const chosen = selectedCompanyCard(picks);

  if (denied("companies", "view")) return <NoAccess entity="companies" />;

  // A new search, filter or page size starts again at page 1.
  const filter = (next: WzFilterPick[]) => {
    setPicks(next);
    setPage(1);
  };
  const onSort = (id: CompanyFieldId) => {
    setSort((s) => (s?.id === id ? { id, dir: s.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" }));
    setPage(1);
  };
  const open = (c: Company, e: WzRowOpenEvent) => {
    const url = `/companies/${c.id}`;
    const newTab = e.metaKey || e.ctrlKey || ("button" in e && e.button === 1);
    if (newTab) window.open(url, "_blank", "noopener,noreferrer");
    else router.push(url);
  };

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="companies-scroller">
      {/* The KPI cards: 317×81, 31px apart, 20px in (pg_contacts_wz_01: x=220, y=126). */}
      <div className="grid grid-cols-2 gap-[31px] px-5 pt-[34px] xl:grid-cols-4">
        {ready
          ? kpis.map((k) => (
              <WzKpiCard
                key={k.key}
                value={k.value}
                caption={k.caption}
                label={k.label}
                // Workiz's Estimates / Invoices cards: the picked one turns left-orange; a second click keeps it.
                onSelect={() => filter(companyCardPicks(k.key))}
                selected={chosen === k.key}
                selectedTone="orange"
              />
            ))
          : [0, 1, 2, 3].map((i) => <WzKpiCardSkeleton key={i} />)}
      </div>

      {/* Filter results (664×38) and "+ Add Company" at the right, tops aligned.
          Workiz's "Show Franchises Clients" row sits between — we have no franchises. */}
      <div className="mt-[44px] flex items-start gap-4 px-5">
        {ready ? (
          <WzFilterSelect groups={FILTER_GROUPS} value={picks} onChange={filter} className="w-[664px] max-w-full" />
        ) : (
          <Skeleton className="h-[38px] w-[664px] max-w-full" />
        )}
        {ready && can("companies", "create") ? (
          <Button className="ml-auto h-8 shrink-0 gap-[3px] border-0 px-3" onClick={() => setCreating(true)}>
            <Plus className="size-5" strokeWidth={2} />
            <span className="px-1">Add Company</span>
          </Button>
        ) : null}
      </div>

      {/* The grey strip: Search; the page size and Fields at the right. */}
      <WzListToolbar className="mt-[63px]">
        <WzSearchBox
          type="search"
          value={search}
          maxLength={100}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
        />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect
            value={pageSize}
            sizes={COMPANY_PAGE_SIZES}
            onChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
          />
          <WzFieldsPanel options={FIELD_OPTIONS} used={columns} onSave={saveColumns} />
        </div>
      </WzListToolbar>

      {/* The grid runs edge to edge, the pager in its foot. */}
      <CompaniesTable
        companies={ready ? view.rows : NO_ROWS}
        columns={columns}
        sort={sort}
        onSort={onSort}
        onOpen={open}
        loading={!ready}
        footer={
          ready ? (
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
          ) : null
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Company</DialogTitle>
          </DialogHeader>
          <CompanyForm
            onCancel={() => setCreating(false)}
            onDone={(c) => {
              setCreating(false);
              router.push(`/companies/${c.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
