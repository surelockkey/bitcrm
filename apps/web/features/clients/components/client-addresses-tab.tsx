"use client";

import { useMemo } from "react";
import { WzLocalGrid, type WzGridColumn } from "@/components/workiz/local-grid";
import { wzMoney, type ClientAddressRow } from "../client-page";

/** Ours: which of the client's two addresses a row is, in a quiet chip after the name. */
const FLAG = "ml-1.5 rounded-chip bg-wz-secondary-hover px-1 text-[11px] leading-4 font-medium text-wz-slate";

/**
 * Workiz's Addresses tab (pg_contact_wz_269669_tab_addresses): one row per
 * distinct address — Name | Address | City | State | Zipcode | Jobs | Total |
 * Due | past_due — with the jobs done there and what they came to. The card
 * fetches every job of the client on opening, so the counts settle on their
 * own. Ours flags the client's service and billing address.
 */
export function ClientAddressesTab({ rows, money, complete }: { rows: ClientAddressRow[]; money: boolean; complete: boolean }) {
  const columns = useMemo<WzGridColumn<ClientAddressRow>[]>(() => {
    const line = (r: ClientAddressRow) => (r.address.unit ? `${r.address.street}, ${r.address.unit}` : r.address.street);
    const figure = (n: number) => (money ? wzMoney(n) : "");
    return [
      {
        id: "name",
        label: "Name",
        sortValue: (r) => r.address.street,
        searchText: (r) => r.address.street,
        render: (r) => (
          <>
            {r.address.street}
            {r.isService ? <span className={FLAG}>Service</span> : null}
            {r.isBilling ? <span className={FLAG}>Billing</span> : null}
          </>
        ),
      },
      { id: "address", label: "Address", sortValue: line, searchText: line, render: line },
      { id: "city", label: "City", sortValue: (r) => r.address.city, searchText: (r) => r.address.city, render: (r) => r.address.city ?? "" },
      { id: "state", label: "State", sortValue: (r) => r.address.state, searchText: (r) => r.address.state, render: (r) => r.address.state ?? "" },
      { id: "zip", label: "Zipcode", sortValue: (r) => r.address.zip, searchText: (r) => r.address.zip, render: (r) => r.address.zip ?? "" },
      { id: "jobs", label: "Jobs", sortValue: (r) => r.jobs, render: (r) => String(r.jobs) },
      { id: "total", label: "Total", sortValue: (r) => r.total, render: (r) => figure(r.total) },
      { id: "due", label: "Due", sortValue: (r) => r.due, render: (r) => figure(r.due) },
      { id: "pastDue", label: "past_due", sortValue: (r) => r.pastDue, render: (r) => figure(r.pastDue) },
    ];
  }, [money]);

  return (
    <WzLocalGrid
      label="Addresses"
      searchLabel="Search addresses"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      footer={!complete ? <p className="px-2.5 pt-2 text-xs text-wz-outline-label">Still counting the client&apos;s jobs…</p> : null}
    />
  );
}
