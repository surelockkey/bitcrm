"use client";

import { useState } from "react";
import Link from "next/link";
import type { Deal } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { formatMoney } from "@/features/deals/lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { paginate } from "@/features/reports/lib";
import { jobDateLabel } from "../client-page";
import { ClientPagination } from "./client-pagination";

/** Workiz's Jobs tab columns, in its order (Job Name is the per-job client name). */
const COLUMNS = ["Id", "Name", "Address", "City", "State", "Zipcode", "Job Date", "Job Type", "Status", "Total", "Amount Due"] as const;

export function ClientJobsTab({
  deals,
  amountDue,
  money,
  isLoading,
  complete,
}: {
  /** Every job of the client the card has fetched so far, newest schedule first. */
  deals: Deal[];
  /** dealId → balance due on its invoice. */
  amountDue: Map<string, number>;
  money: boolean;
  isLoading: boolean;
  /** All of the client's jobs are in hand, so the page count is final. */
  complete: boolean;
}) {
  const jobTypeName = useJobTypeName();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const paged = paginate(deals, page, size);

  if (isLoading) return <Skeleton className="m-4 h-40" />;
  if (deals.length === 0) return <p className="p-6 text-sm text-muted-foreground">No jobs yet.</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="border-y">
        <Table aria-label="Jobs">
          <TableHeader>
            <TableRow>
              {COLUMNS.map((c) => (
                <TableHead key={c} className={c === "Total" || c === "Amount Due" ? "text-right" : undefined}>
                  {c}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.rows.map((d) => {
              const name = d.clientName ? `${d.clientName.firstName} ${d.clientName.lastName}`.trim() : (d.businessProfileName ?? "");
              const due = amountDue.get(d.id);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/deals/${d.id}`} className="font-mono font-medium text-brand hover:underline">
                      {d.dealNumber}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-56 truncate">{name}</TableCell>
                  <TableCell className="max-w-56 truncate">{d.address?.street ? `${d.address.street}${d.address.unit ? ` ${d.address.unit}` : ""}` : "—"}</TableCell>
                  <TableCell>{d.address?.city ?? ""}</TableCell>
                  <TableCell>{d.address?.state ?? ""}</TableCell>
                  <TableCell>{d.address?.zip ?? ""}</TableCell>
                  <TableCell className="whitespace-nowrap">{jobDateLabel(d)}</TableCell>
                  <TableCell className="max-w-44 truncate">{jobTypeName(d.jobTypeId)}</TableCell>
                  <TableCell>
                    <StageBadge status={d.superStatus} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money ? formatMoney(d.totals?.total ?? 0) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money ? (due === undefined ? "—" : formatMoney(due)) : "—"}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ClientPagination page={paged.page} pages={paged.pages} total={paged.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
      {!complete ? <p className="px-1 text-xs text-muted-foreground">Still counting the client&apos;s jobs…</p> : null}
    </div>
  );
}
