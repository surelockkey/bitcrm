"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@bitcrm/types";
import { WzReportGrid, type WzReportColumn } from "@/components/workiz/report-grid";
import { personName } from "@/features/deals/person-name";
import { useRoleMembers } from "../hooks";

const COLUMNS: WzReportColumn<User>[] = [
  {
    id: "name",
    label: "Name",
    cell: (u) => (
      <>
        <span className="block truncate">{personName(u) ?? u.email}</span>
        <span className="mt-[5px] block overflow-hidden text-xs leading-4 text-ellipsis text-wz-caption">{u.email}</span>
      </>
    ),
  },
  { id: "department", label: "Department", cell: (u) => <span className="block truncate">{u.department}</span> },
  { id: "status", label: "Status", cell: (u) => (u.status === "active" ? "Active" : "Inactive") },
];

/**
 * Ours (Workiz's role modal has no such tab): who holds the role, in the Team
 * grid's look — name over email, department, status — a row opening the
 * person on the Users page, where a role is changed.
 */
export function RoleMembers({ roleId }: { roleId: string }) {
  const router = useRouter();
  const { data: members, isLoading, isError } = useRoleMembers(roleId);
  const list = members ?? [];

  if (isError) {
    return <p className="py-8 text-center text-sm text-wz-strong">Couldn&apos;t load members.</p>;
  }

  return (
    <div>
      <p className="mb-4 flex items-center gap-4 text-[13px] leading-[19px] text-wz-strong">
        <span>
          {list.length === 0
            ? "No one has this role — assign it to a user from the Users page."
            : `${list.length} ${list.length === 1 ? "user holds" : "users hold"} this role`}
        </span>
        <Link href="/admin/users" className="font-semibold text-wz-link hover:underline">
          Manage in Users
        </Link>
      </p>
      <WzReportGrid
        aria-label="Members"
        columns={COLUMNS}
        rows={list}
        rowKey={(u) => u.id}
        loading={isLoading}
        stickyHeader={false}
        minRows={5}
        plainFiller
        emptyText={null}
        onRowClick={(u) => router.push(`/admin/users?user=${u.id}`)}
      />
    </div>
  );
}
