"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { Invoice } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListPagination } from "@/components/ui/list-pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { FilterChip, NoAccess, StatTile } from "@/features/billing/components/list-bits";
import { createInvoice } from "../api";
import { useCreateInvoice, useInvoiceList, useInvoiceSummary, useJobsNeedingInvoice , useInvoiceCount } from "../hooks";
import { INVOICE_CHIPS, runSequentially, type InvoiceChip } from "../lib";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { SentBadge } from "./sent-badge";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";

const PAGE_SIZE = 50;

type View = "invoices" | "needs";

export function InvoicesPage() {
  const { can } = usePermissions();
  const canView = can("invoices", "view");
  const [view, setView] = useState<View>("invoices");
  const [chip, setChip] = useState<InvoiceChip>("all");
  const [unsent, setUnsent] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const summary = useInvoiceSummary(canView);

  if (!canView) return <NoAccess what="invoices" />;

  const s = summary.data;
  const pick = (next: InvoiceChip) => {
    setView("invoices");
    setChip(next);
    setUnsent(false);
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Invoices</h1>
        <div role="tablist" aria-label="View" className="ml-auto flex rounded-md border p-0.5">
          {(
            [
              ["invoices", "Invoices"],
              ["needs", `Needs invoice${s ? ` · ${s.needsInvoiceCount}` : ""}`],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-7 rounded px-3 text-xs font-medium transition-colors",
                view === v ? "bg-brand text-brand-foreground" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatTile
            label="Due"
            tone="amber"
            loading={summary.isLoading}
            value={formatMoney(s?.dueAmount ?? 0)}
            hint={s ? `${s.dueCount} invoice${s.dueCount === 1 ? "" : "s"}` : undefined}
            active={view === "invoices" && chip === "due" && !unsent}
            onClick={() => pick("due")}
          />
          <StatTile
            label="Overdue"
            tone="red"
            loading={summary.isLoading}
            value={formatMoney(s?.overdueAmount ?? 0)}
            hint={s ? `${s.overdueCount} invoice${s.overdueCount === 1 ? "" : "s"}` : undefined}
            active={view === "invoices" && chip === "overdue" && !unsent}
            onClick={() => pick("overdue")}
          />
          <StatTile
            label="Unsent"
            tone="sky"
            loading={summary.isLoading}
            value={String(s?.unsentCount ?? 0)}
            hint="Not sent to the client"
            active={view === "invoices" && unsent && chip === "all"}
            onClick={() => {
              setView("invoices");
              setChip("all");
              setUnsent(true);
            }}
          />
          <StatTile
            label="Needs invoice"
            loading={summary.isLoading}
            value={String(s?.needsInvoiceCount ?? 0)}
            hint="Jobs with items, no invoice"
            active={view === "needs"}
            onClick={() => setView("needs")}
          />
        </div>

        {view === "invoices" ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {INVOICE_CHIPS.map((c) => (
                <FilterChip key={c.value} active={chip === c.value} onClick={() => setChip(c.value)}>
                  {c.label}
                </FilterChip>
              ))}
              <label className="ml-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Switch checked={unsent} onCheckedChange={setUnsent} aria-label="Unsent only" />
                Unsent only
              </label>
              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                <Label htmlFor="inv-from" className="text-xs text-muted-foreground">From</Label>
                <Input id="inv-from" type="date" className="h-8 w-36" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                <Label htmlFor="inv-to" className="text-xs text-muted-foreground">To</Label>
                <Input id="inv-to" type="date" className="h-8 w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                {from || to ? (
                  <Button variant="ghost" size="icon" className="size-8" aria-label="Clear dates" onClick={() => { setFrom(""); setTo(""); }}>
                    <X />
                  </Button>
                ) : null}
              </div>
            </div>
            <InvoicesTable
              params={{
                status: chip === "all" ? undefined : chip,
                unsent: unsent || undefined,
                from: from || undefined,
                to: to || undefined,
                limit: PAGE_SIZE,
              }}
            />
          </>
        ) : (
          <NeedsInvoiceTable canCreate={can("invoices", "create")} />
        )}
      </div>
    </div>
  );
}

function InvoicesTable({ params }: { params: Parameters<typeof useInvoiceList>[0] }) {
  const router = useRouter();
  const [pageSize, setPageSize] = usePageSize("invoices");
  const q = useInvoiceList({ ...params, limit: pageSize });
  const count = useInvoiceCount(params);
  const pager = usePager(pagedSource(q, (page: { items: Invoice[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ params, pageSize }),
  });
  const rows: Invoice[] = pager.items;
  const { map: contacts } = useContactsByIds(rows.map((r) => r.contactId));

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load invoices")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileText className="size-6" />
        <p className="text-sm">No invoices match these filters.</p>
      </div>
    );
  }

  const open = (inv: Invoice) => router.push(`/deals/${inv.dealId}?tab=invoice`);

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Invoice #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Job</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((inv) => {
              const c = contacts.get(inv.contactId);
              return (
                <TableRow
                  key={inv.id}
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => open(inv)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") open(inv);
                  }}
                >
                  <TableCell className="font-mono font-medium">#{inv.number}</TableCell>
                  <TableCell className="max-w-48 truncate">{c ? contactName(c) : "—"}</TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">{formatYmd(inv.invoiceDate || inv.createdAt)}</TableCell>
                  <TableCell className={cn("tabular-nums", inv.status === "overdue" ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>
                    {formatYmd(inv.dueDate)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.totals?.total ?? 0)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(inv.totals?.balanceDue ?? 0)}</TableCell>
                  <TableCell><InvoiceStatusBadge status={inv.status} /></TableCell>
                  <TableCell><SentBadge sentAt={inv.sentAt} /></TableCell>
                  <TableCell>
                    <Link
                      href={`/deals/${inv.dealId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Job <ExternalLink className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
    </div>
  );
}

function NeedsInvoiceTable({ canCreate }: { canCreate: boolean }) {
  const qc = useQueryClient();
  const q = useJobsNeedingInvoice();
  const createOne = useCreateInvoice();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const jobs = useMemo(() => q.data ?? [], [q.data]);
  const visibleSelected = jobs.filter((j) => selected.has(j.id)).map((j) => j.id);
  const allChecked = jobs.length > 0 && visibleSelected.length === jobs.length;

  const bulkCreate = async () => {
    const ids = visibleSelected;
    if (!ids.length) return;
    setBulkRunning(true);
    const tid = toast.loading(`Creating invoices… 0/${ids.length}`);
    const { succeeded, failed } = await runSequentially(ids, createInvoice, (done, total) =>
      toast.loading(`Creating invoices… ${done}/${total}`, { id: tid }),
    );
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
    setSelected(new Set(failed.map((f) => f.id)));
    setBulkRunning(false);
    if (failed.length === 0) {
      toast.success(`Created ${succeeded.length} invoice${succeeded.length === 1 ? "" : "s"}`, { id: tid });
    } else {
      toast.error(
        `Created ${succeeded.length}, ${failed.length} failed: ${getApiErrorMessage(failed[0].error)}`,
        { id: tid },
      );
    }
  };

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load jobs")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (jobs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <FileText className="size-6" />
        <p className="text-sm">Every job with items has an invoice.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {canCreate ? (
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {visibleSelected.length ? `${visibleSelected.length} selected` : "Select jobs to invoice in bulk"}
          </p>
          <Button
            variant="brand"
            size="sm"
            className="ml-auto"
            disabled={!visibleSelected.length || bulkRunning}
            onClick={bulkCreate}
          >
            {bulkRunning ? <Loader2 className="animate-spin" /> : <FileText />}
            Create invoices{visibleSelected.length ? ` (${visibleSelected.length})` : ""}
          </Button>
        </div>
      ) : null}
      <div className="overflow-x-auto border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {canCreate ? (
                <TableHead className="w-8">
                  <Checkbox
                    aria-label="Select all jobs"
                    checked={allChecked ? true : visibleSelected.length ? "indeterminate" : false}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(jobs.map((j) => j.id)) : new Set())}
                  />
                </TableHead>
              ) : null}
              <TableHead>Job #</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {canCreate ? <TableHead className="w-32" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                {canCreate ? (
                  <TableCell>
                    <Checkbox
                      aria-label={`Select job ${j.dealNumber}`}
                      checked={selected.has(j.id)}
                      onCheckedChange={(v) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (v === true) next.add(j.id);
                          else next.delete(j.id);
                          return next;
                        })
                      }
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Link href={`/deals/${j.id}?tab=items`} className="font-mono font-medium text-primary hover:underline">
                    #{j.dealNumber}
                  </Link>
                </TableCell>
                <TableCell className="max-w-48 truncate">{j.clientName || "—"}</TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatYmd(j.createdAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{j.itemCount}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(j.total)}</TableCell>
                {canCreate ? (
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={bulkRunning || (createOne.isPending && createOne.variables === j.id)}
                      onClick={() => createOne.mutate(j.id)}
                    >
                      {createOne.isPending && createOne.variables === j.id ? <Loader2 className="animate-spin" /> : null}
                      Create invoice
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
