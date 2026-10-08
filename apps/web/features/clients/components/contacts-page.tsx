"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, CalendarDays, Diamond, Mail, MapPin, Merge, Phone, Plus, Users } from "lucide-react";
import type { Contact } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WzFieldsPanel, type WzFieldOption } from "@/components/workiz/fields-panel";
import { WzFilterSelect, type WzFilterGroup, type WzFilterPick } from "@/components/workiz/filter-select";
import { WzPager, type WzPagerState } from "@/components/workiz/pager";
import { WzStatCard, WzStatCardSkeleton } from "@/components/workiz/stat-card";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "@/components/workiz/toolbar";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { settled } from "@/lib/use-page-ready";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useJobSources } from "@/features/job-sources/hooks";
import { useClientTags } from "@/features/client-tags/hooks";
import { activeClientTags, tagSolidClasses } from "@/features/client-tags/lib";
import { useEstimateSummary } from "@/features/estimates/hooks";
import { useClientBalances, useCompaniesByIds, useContactSearchPage, useContactsCount, useContactsPage } from "../hooks";
import { useLastWhole } from "../use-last-whole";
import { useClientFieldsStore } from "../clients-fields-store";
import {
  CLIENT_DEFAULT_PAGE_SIZE,
  CLIENT_FIELDS,
  CLIENT_PAGE_SIZES,
  CLIENT_SEARCH_DEBOUNCE_MS,
  clientKpis,
  searchPager,
  type ClientFieldIcon,
} from "../clients-list";
import { ClientsGrid, ClientsGridSkeleton } from "./clients-grid";
import { ContactForm } from "./contact-form";
import { MergeContactsDialog } from "./merge-contacts-dialog";

const NO_ROWS: Contact[] = [];

/** The panel's glyphs (Workiz's `wfi-*`), by their nearest lucide twins. */
const FIELD_ICONS: Record<ClientFieldIcon, React.ReactNode> = {
  users: <Users />,
  location: <MapPin />,
  phone: <Phone />,
  calendar: <CalendarDays />,
  email: <Mail />,
  source: <BarChart3 />,
  type: <Diamond />,
};
const FIELD_OPTIONS: WzFieldOption[] = CLIENT_FIELDS.map((f) => ({ id: f.id, label: f.label, icon: FIELD_ICONS[f.icon] }));

/** The footer's numbers, frozen with the rows they describe. */
type FooterNumbers = Pick<WzPagerState, "page" | "from" | "to" | "total" | "totalIsFloor" | "totalPages" | "totalPagesIsFloor">;

/**
 * The Clients list, as Workiz draws `/root/clients/` (captures
 * `pg_contacts_wz_*`): four KPI cards; "Filter results" (client tags) with
 * "+ Add Client" at the right; the grey strip — Search, the page size,
 * "Merge" (ours, where Workiz has Export) and "Fields"; the grid — Name
 * (email or number under it, then the tags) | Address | Phone | Created,
 * or the columns the Visible fields panel saved; Workiz's pager under it.
 *
 * Everything the grid shows comes from the server a page at a time: the CRM
 * pages the list (tags included), the search service pages the Search box's
 * matches with their total. Workiz asks ~1 s after the last key; so does this.
 * One skeleton, then the whole page; a new page, search or filter keeps the
 * rows on screen under a white wash until the next set is whole.
 */
export function ContactsPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);

  // Search: the text as typed, and as asked — 1 s after the last key. Cleared
  // text asks at once (the × or a select-all-delete), as there is nothing to wait for.
  const [searchText, setSearchText] = useState("");
  const settledText = useDebouncedValue(searchText.trim(), CLIENT_SEARCH_DEBOUNCE_MS);
  const query = searchText.trim() ? settledText : "";
  const searching = query.length > 0;

  // Filter results → TAGS (any of them, as Workiz's).
  const [picks, setPicks] = useState<WzFilterPick[]>([]);
  const tagIds = useMemo(() => picks.filter((p) => p.group === "tag").map((p) => p.value), [picks]);

  const [pageSize, setPageSize] = usePageSize("clients", { sizes: CLIENT_PAGE_SIZES, fallback: CLIENT_DEFAULT_PAGE_SIZE });
  const columns = useClientFieldsStore((s) => s.used);
  const saveColumns = useClientFieldsStore((s) => s.save);

  // The list a page at a time.
  const pageQuery = useContactsPage(undefined, !searching, pageSize, tagIds);
  const count = useContactsCount(undefined, !searching, tagIds);
  const pager = usePager(pagedSource(pageQuery), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: `${pageSize}|${tagIds.join(",")}`,
  });

  // The search a page at a time; a new text, size or filter starts at page 1.
  const [searchPage, setSearchPage] = useState(1);
  const searchKey = `${query}|${pageSize}|${tagIds.join(",")}`;
  const [seenSearchKey, setSeenSearchKey] = useState(searchKey);
  if (seenSearchKey !== searchKey) {
    setSeenSearchKey(searchKey);
    if (searchPage !== 1) setSearchPage(1);
  }
  const found = useContactSearchPage(query, searchPage, pageSize);
  // The search service knows nothing of tags: a picked tag narrows its page here.
  const foundRows = useMemo(
    () => (tagIds.length ? found.rows.filter((c) => c.tagIds?.some((t) => tagIds.includes(t))) : found.rows),
    [found.rows, tagIds],
  );

  // The cards: the whole list's count, and the money the viewer may see.
  const allCount = useContactsCount(undefined, true);
  const seesInvoices = !permsLoading && can("invoices", "view");
  const seesEstimates = !permsLoading && can("estimates", "view");
  const balances = useClientBalances(seesInvoices);
  const estimateSummary = useEstimateSummary(seesEstimates);

  const clientTags = useClientTags();
  const tagMap = useMemo(() => new Map((clientTags.data ?? []).map((t) => [t.id, t])), [clientTags.data]);
  const filterGroups: WzFilterGroup[] = useMemo(
    () => [
      {
        id: "tag",
        title: "Tags",
        chipPrefix: "tag",
        options: activeClientTags(clientTags.data).map((t) => ({ value: t.id, label: t.name, colorClassName: tagSolidClasses(t.color) })),
      },
    ],
    [clientTags.data],
  );

  // What the columns print beside the rows, asked for only when shown.
  const showsCompany = columns.includes("company");
  const showsSource = columns.includes("source");
  const jobSources = useJobSources();
  // A server from before the tag filter sends every row: the picked tags still hold here.
  const listRows = useMemo(
    () => (tagIds.length ? pager.items.filter((c) => c.tagIds?.some((t) => tagIds.includes(t))) : pager.items),
    [pager.items, tagIds],
  );
  const rows = searching ? foundRows : listRows.length ? listRows : NO_ROWS;
  const companies = useCompaniesByIds(
    useMemo(
      () => (showsCompany ? rows.map((c) => c.companyId).filter((id): id is string => !!id) : []),
      [rows, showsCompany],
    ),
  );
  // Merge looks across everything paged through, not one page: two records
  // of one person seldom sit side by side.
  const loaded = useMemo(() => pageQuery.data?.pages.flatMap((p) => p.data) ?? [], [pageQuery.data]);

  const footer: WzPagerState = searching
    ? searchPager({ page: searchPage, size: pageSize, total: tagIds.length ? undefined : found.total, rows: foundRows.length, setPage: setSearchPage })
    : pager;
  const { page, from, to, total, totalIsFloor, totalPages, totalPagesIsFloor } = footer;

  // Whole: the rows with everything printed beside them, the cards' numbers,
  // the tag catalog the chips are named from — up together, in one frame.
  const listIn = settled(pageQuery) && !pageQuery.isPlaceholderData && settled(count);
  const cardsIn = settled(allCount) && settled(balances) && settled(estimateSummary);
  const whole =
    !permsLoading &&
    cardsIn &&
    settled(clientTags) &&
    (!showsSource || settled(jobSources)) &&
    !(showsCompany && companies.isLoading) &&
    (searching ? found.answered : listIn);
  const view = useMemo(
    () => ({
      rows,
      companyMap: companies.map,
      searching,
      numbers: { page, from, to, total, totalIsFloor, totalPages, totalPagesIsFloor } as FooterNumbers,
    }),
    // The numbers by value: the pager is a new object every render.
    [rows, companies.map, searching, page, from, to, total, totalIsFloor, totalPages, totalPagesIsFloor],
  );
  const { shown, stale } = useLastWhole(view, whole);

  if (denied("contacts", "view")) return <NoAccess entity="contacts" />;

  const kpis = clientKpis({
    clients: typeof allCount.data?.total === "number" ? { total: allCount.data.total, atLeast: allCount.data.atLeast } : undefined,
    invoices: seesInvoices && balances.data ? balances.data : undefined,
    estimates: seesEstimates && estimateSummary.data ? estimateSummary.data.pending : undefined,
  });

  const open = (c: Contact, e: MouseEvent) => {
    const url = `/contacts/${c.id}`;
    if (e.metaKey || e.ctrlKey || e.button === 1) window.open(url, "_blank", "noopener,noreferrer");
    else router.push(url);
  };

  // While a new set is out, ‹ › wait for it: their page numbers belong to it.
  const pagerState: WzPagerState | null = shown
    ? {
        ...shown.numbers,
        canPrev: !stale && shown.numbers.page > 1,
        canNext: !stale && footer.canNext,
        isFetching: stale,
        prev: () => (searching ? setSearchPage((p) => Math.max(1, p - 1)) : pager.prev()),
        next: () => (searching ? setSearchPage((p) => p + 1) : pager.next()),
      }
    : null;

  return (
    // The page scrolls itself inside the shell, as Workiz's main container does.
    <div className="flex min-h-0 flex-1 flex-col overflow-auto text-wz-strong" data-slot="clients-scroller">
      {/* The KPI cards: 317×81, 31px apart, 20px in (pg_contacts_wz_01: x=220, y=126). */}
      <div className="grid grid-cols-2 gap-[31px] px-5 pt-[34px] xl:grid-cols-4">
        {shown
          ? kpis.map((k) => <WzStatCard key={k.key} value={k.value} caption={k.caption} tone={k.tone} label={k.label} />)
          : (["ink", "orange", "red", "ink"] as const).map((tone, i) => <WzStatCardSkeleton key={i} tone={tone} />)}
      </div>

      {/* Filter results (664×38) and "+ Add Client" at the right, tops aligned.
          Workiz's "Show Franchises Clients" row sits between — we have no franchises. */}
      <div className="mt-[44px] flex items-start gap-4 px-5">
        {shown ? (
          <WzFilterSelect groups={filterGroups} value={picks} onChange={setPicks} className="w-[664px] max-w-full" />
        ) : (
          <Skeleton className="h-[38px] w-[664px] max-w-full" />
        )}
        {shown && can("contacts", "create") ? (
          <Button className="ml-auto h-8 shrink-0 gap-[3px] border-0 px-3" onClick={() => setCreating(true)}>
            <Plus className="size-5" strokeWidth={2} />
            <span className="px-1">Add Client</span>
          </Button>
        ) : null}
      </div>

      {/* The grey strip: Search; the page size, Merge (ours, in Export's place) and Fields at the right. */}
      <WzListToolbar className="mt-[63px]">
        <WzSearchBox value={searchText} onChange={setSearchText} maxLength={100} />
        <div className="ml-auto flex items-center gap-4">
          <WzPageSizeSelect value={pageSize} sizes={CLIENT_PAGE_SIZES} onChange={setPageSize} />
          {/* Merge soft-deletes the duplicates, so it follows the delete permission (backend guard). */}
          {shown && can("contacts", "delete") ? (
            <WzToolbarButton onClick={() => setMerging(true)}>
              <Merge strokeWidth={1.75} />
              Merge
            </WzToolbarButton>
          ) : null}
          <WzFieldsPanel options={FIELD_OPTIONS} used={columns} onSave={saveColumns} />
        </div>
      </WzListToolbar>

      {/* The grid runs edge to edge, then the pager. */}
      {!shown ? (
        <ClientsGridSkeleton columns={columns} />
      ) : (
        <div aria-busy={stale || undefined} className="relative">
          <ClientsGrid contacts={shown.rows} columns={columns} companyMap={shown.companyMap} tagMap={tagMap} onOpen={open} />
          {pagerState ? <WzPager pager={pagerState} nav /> : null}
          {/* Workiz keeps the rows it has under a white wash until the next set is in. */}
          {stale ? <div aria-hidden className="pointer-events-none absolute inset-0 z-20 bg-white/60" /> : null}
        </div>
      )}

      <MergeContactsDialog open={merging} onOpenChange={setMerging} contacts={loaded} />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Client</DialogTitle>
          </DialogHeader>
          <ContactForm
            onCancel={() => setCreating(false)}
            onDone={(c) => {
              setCreating(false);
              router.push(`/contacts/${c.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function NoAccess({ entity }: { entity: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">No access</h2>
      <p className="text-sm text-muted-foreground">
        You don&apos;t have permission to view {entity}.
      </p>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">{icon}</div>
      <div className="font-medium">{title}</div>
      <p className="max-w-xs text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
