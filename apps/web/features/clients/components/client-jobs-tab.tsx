"use client";

import { useMemo, useState, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Deal } from "@bitcrm/types";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { DEFAULT_TZ } from "@/lib/timezone";
import { DealQuickView } from "@/features/deals/components/deal-quick-view";
import { superStatusLabel } from "@/features/deals/lib";
import { useJobStatusName } from "@/features/job-statuses/lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { clientJobDate, wzMoney } from "../client-page";

/** Opens in a new tab with ⌘/Ctrl or the middle button, as a link would. */
export function openRow(router: ReturnType<typeof useRouter>, href: string, e: MouseEvent) {
  // A link inside the row (the Id, a job number) answers the click itself.
  if ((e.target as HTMLElement).closest("a, button")) return;
  if (e.metaKey || e.ctrlKey || e.button === 1) window.open(href, "_blank", "noopener,noreferrer");
  else router.push(href);
}

/** A grid cell's link that reads as plain text, as Workiz's Id does (the row is the link). */
export const PLAIN_LINK = "text-inherit no-underline outline-none focus-visible:underline";

/**
 * Workiz's Jobs tab (pg_contact_wz_269669_01): Id | Job Name | Name | Address |
 * City | State | Zipcode | Job Date | Job Type | Status | Total | Amount Due |
 * Past Due, newest visit first (the Job Date header shows the bar), figures
 * plain ("67,291.00"), "Quick view" under the Id on hover, the row opens the
 * job. The money columns stay blank for a role without `financials.view`.
 */
export function ClientJobsTab({
  deals,
  amountDue,
  pastDue,
  money,
  zoneOf,
  complete,
}: {
  /** Every job of the client the card has fetched so far, newest schedule first. */
  deals: Deal[];
  /** dealId → balance due on its invoice. */
  amountDue: Map<string, number>;
  /** dealId → the part of it past its due date. */
  pastDue: Map<string, number>;
  money: boolean;
  /** The zone a visit was booked in (the job's own, else its area's). */
  zoneOf: (deal: Deal) => string | undefined;
  /** All of the client's jobs are in hand, so the page count is final. */
  complete: boolean;
}) {
  const router = useRouter();
  const jobTypeName = useJobTypeName();
  const statusName = useJobStatusName();
  const [quick, setQuick] = useState<string | null>(null);

  const columns = useMemo<WzGridColumn<Deal>[]>(() => {
    const clientName = (d: Deal) =>
      d.clientName ? `${d.clientName.firstName} ${d.clientName.lastName}`.trim() : (d.businessProfileName ?? "");
    const street = (d: Deal) => (d.address?.street ? `${d.address.street}${d.address.unit ? ` ${d.address.unit}` : ""}` : "");
    const status = (d: Deal) => (d.subStatusId ? statusName(d.subStatusId) : superStatusLabel(d.superStatus));
    const figure = (n: number | undefined) => (money ? wzMoney(n ?? 0) : "");
    return [
      {
        id: "id",
        label: "Id",
        width: 130,
        sortValue: (d) => d.dealNumber,
        searchText: (d) => d.dealNumber,
        render: (d) => (
          <div className="group/id">
            <Link href={`/deals/${d.id}`} className={PLAIN_LINK}>
              {d.dealNumber}
            </Link>
            {/* Workiz shows "Quick view" under the Id while the row is under the cursor. */}
            <button
              type="button"
              aria-label={`Quick view ${d.dealNumber}`}
              onClick={() => setQuick(d.id)}
              className="mt-[5px] block rounded-[3px] bg-[#61747d] px-[5.5px] py-px text-xs leading-4 font-medium tracking-[0.4px] text-white opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            >
              Quick view
            </button>
          </div>
        ),
      },
      { id: "jobName", label: "Job Name", sortValue: (d) => d.jobName, searchText: (d) => d.jobName, render: (d) => d.jobName ?? "" },
      { id: "name", label: "Name", sortValue: clientName, searchText: clientName, render: clientName },
      { id: "address", label: "Address", sortValue: street, searchText: street, render: street },
      { id: "city", label: "City", sortValue: (d) => d.address?.city, searchText: (d) => d.address?.city, render: (d) => d.address?.city ?? "" },
      { id: "state", label: "State", sortValue: (d) => d.address?.state, searchText: (d) => d.address?.state, render: (d) => d.address?.state ?? "" },
      { id: "zip", label: "Zipcode", sortValue: (d) => d.address?.zip, searchText: (d) => d.address?.zip, render: (d) => d.address?.zip ?? "" },
      {
        id: "jobDate",
        label: "Job Date",
        sortValue: (d) => (d.scheduledDate ? `${d.scheduledDate} ${d.allDay ? "" : (d.scheduledTimeSlot ?? "")}` : undefined),
        searchText: (d) => clientJobDate(d, zoneOf(d), DEFAULT_TZ),
        render: (d) => clientJobDate(d, zoneOf(d), DEFAULT_TZ),
      },
      {
        id: "jobType",
        label: "Job Type",
        sortValue: (d) => jobTypeName(d.jobTypeId),
        searchText: (d) => jobTypeName(d.jobTypeId),
        render: (d) => jobTypeName(d.jobTypeId),
      },
      { id: "status", label: "Status", sortValue: status, searchText: status, render: status },
      { id: "total", label: "Total", sortValue: (d) => d.totals?.total ?? 0, render: (d) => figure(d.totals?.total) },
      { id: "amountDue", label: "Amount Due", sortValue: (d) => amountDue.get(d.id) ?? 0, render: (d) => figure(amountDue.get(d.id)) },
      { id: "pastDue", label: "Past Due", sortValue: (d) => pastDue.get(d.id) ?? 0, render: (d) => figure(pastDue.get(d.id)) },
    ];
  }, [amountDue, pastDue, money, zoneOf, jobTypeName, statusName]);

  return (
    <>
      <WzLocalGrid
        label="Jobs"
        searchLabel="Search jobs"
        columns={columns}
        rows={deals}
        rowKey={(d) => d.id}
        defaultSort={{ id: "jobDate", dir: "desc" }}
        rowClassName="group/row"
        onRowClick={(d, e) => openRow(router, `/deals/${d.id}`, e)}
        footer={!complete ? <p className="px-2.5 pt-2 text-xs text-wz-outline-label">Still counting the client&apos;s jobs…</p> : null}
      />
      <DealQuickView dealId={quick} open={quick !== null} onOpenChange={(o) => !o && setQuick(null)} />
    </>
  );
}
