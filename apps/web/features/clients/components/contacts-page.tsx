"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Merge, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { settled } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { usePermissions, useDenied } from "@/features/auth/use-permissions";
import { useJobSources } from "@/features/job-sources/hooks";
import type { Contact } from "@bitcrm/types";
import { useContactsPage, useContactSearch, useCompaniesByIds, useContactsCount } from "../hooks";
import { useLastWhole } from "../use-last-whole";
import { ContactsTable } from "./contacts-table";
import { ContactForm } from "./contact-form";
import { MergeContactsDialog } from "./merge-contacts-dialog";

const NO_ROWS: Contact[] = [];

export function ContactsPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const denied = useDenied();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [merging, setMerging] = useState(false);

  // Untyped: the list a page at a time, as the CRM pages it. Typed: the
  // search service answers, hydrated in one call — never the whole table.
  const searching = search.trim().length >= 2;
  const [pageSize, setPageSize] = usePageSize("contacts");
  const pageQuery = useContactsPage(undefined, !searching, pageSize);
  const found = useContactSearch(searching ? search : "");
  // The Source column names its ad sources: asked for with the rows, not by
  // the column once it is on screen.
  const jobSources = useJobSources();

  // Пошук відповідає сервісом пошуку, не сторінками CRM — тоді лічильник
  // списку ні до чого.
  const count = useContactsCount(undefined, !searching);
  const pager = usePager(pagedSource(pageQuery), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: String(pageSize),
  });
  const rows = searching ? found.data : pager.items;
  const filtered = rows.length ? rows : NO_ROWS;
  // Назви компаній — лише тих, що в рядках на екрані.
  const companies = useCompaniesByIds(
    useMemo(() => filtered.map((c) => c.companyId).filter((id): id is string => !!id), [filtered]),
  );
  // Пошук дублікатів дивиться на все, що встигли погортати, а не на одну
  // сторінку: два записи однієї людини рідко стоять поруч.
  const loaded = useMemo(
    () => pageQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [pageQuery.data],
  );

  // The rows go up whole: with their companies, their sources, the count
  // under them and the buttons over them — they used to arrive in five waves.
  // A new search, page or page size keeps the set on screen (dimmed) until
  // the next one is whole, rather than emptying the list or showing rows
  // whose Company column fills in a beat later.
  const listIn = settled(pageQuery) && !pageQuery.isPlaceholderData && settled(count);
  const whole =
    !permsLoading && settled(jobSources) && !companies.isLoading && (searching ? found.answered : listIn);
  const view = useMemo(
    () => ({ rows: filtered, companyMap: companies.map, searching }),
    [filtered, companies.map, searching],
  );
  const { shown, stale } = useLastWhole(view, whole);

  if (denied("contacts", "view")) return <NoAccess entity="contacts" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            People — residents and company representatives.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Merge soft-deletes the duplicates, so it follows the delete permission (backend guard). */}
          {shown && can("contacts", "delete") ? (
            <Button variant="outline" className="gap-1.5" onClick={() => setMerging(true)}>
              <Merge className="size-4" /> Merge
            </Button>
          ) : null}
          {shown && can("contacts", "create") ? (
            <Button variant="brand" className="gap-1.5" onClick={() => setCreating(true)}>
              <Plus className="size-4" /> New contact
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search name, phone, email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <span className="ml-auto text-sm text-muted-foreground">
          {!shown
            ? null
            : shown.searching
              ? `${shown.rows.length} ${shown.rows.length === 1 ? "match" : "matches"}`
              : `Showing ${shown.rows.length}`}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {!shown ? (
          <Skeleton className="h-64 w-full" />
        ) : shown.rows.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title={shown.searching ? "No matching contacts" : "No contacts yet"}
            hint={shown.searching ? "Try a different search." : "Create your first contact to get started."}
          />
        ) : (
          <div aria-busy={stale || undefined} className={cn(stale && "opacity-60")}>
            <ContactsTable contacts={shown.rows} companyMap={shown.companyMap} />
            {/* Знайдене пошуковим сервісом приходить одним набором — там
                гортати нема чого. */}
            {shown.searching ? null : (
              <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
            )}
          </div>
        )}
      </div>

      <MergeContactsDialog
        open={merging}
        onOpenChange={setMerging}
        contacts={loaded}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>New contact</DialogTitle></DialogHeader>
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
