"use client";

import Link from "next/link";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StageBadge } from "@/features/deals/components/deal-badges";
import { formatMoney } from "@/features/deals/lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { jobDateLabel } from "../client-page";

/** Workiz's Jobs tab columns, in its order (Job Name is the per-job client name). */
const COLUMNS = ["Id", "Name", "Address", "City", "State", "Zipcode", "Job Date", "Job Type", "Status", "Total", "Amount Due"] as const;

export function ClientJobsTab({
  deals,
  amountDue,
  money,
  isLoading,
  hasMore,
  loadingMore,
  onMore,
}: {
  deals: Deal[];
  /** dealId → balance due on its invoice. */
  amountDue: Map<string, number>;
  money: boolean;
  isLoading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onMore: () => void;
}) {
  const jobTypeName = useJobTypeName();

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
            {deals.map((d) => {
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
      {hasMore ? (
        <div>
          <Button variant="outline" size="sm" onClick={onMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
