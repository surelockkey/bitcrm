"use client";

import Link from "next/link";
import type { User } from "@bitcrm/types";
import { overrideSummary, type OverrideSummary } from "../overrides";

function summaryLine(s: OverrideSummary): string {
  const parts: string[] = [];
  if (s.permissionCells > 0) {
    parts.push(`${s.permissionCells} permission ${s.permissionCells === 1 ? "override" : "overrides"}`);
  }
  if (s.scopeCells > 0) {
    parts.push(`${s.scopeCells} data scope ${s.scopeCells === 1 ? "override" : "overrides"}`);
  }
  if (s.transitionsOverridden) parts.push("custom stage transitions");
  return parts.join(" · ");
}

/**
 * The "Permissions" tab of the user sheet: whether this person has switches
 * of their own over their role's, and the way into the editor — Workiz's
 * block title, the Team grid's chip, and an outline pill as Workiz's
 * secondary button.
 */
export function UserPermissionsSummary({
  user,
  roleLabel,
  canEdit,
  onClose,
}: {
  user: User;
  roleLabel: string;
  canEdit: boolean;
  onClose: () => void;
}) {
  const s = overrideSummary(user.permissionOverrides);
  return (
    <div className="flex flex-col items-start gap-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm leading-[21px] font-semibold tracking-[0.4px] text-foreground">Per-user permission overrides</h3>
        {s.any ? (
          <span className="rounded-[3px] bg-wz-slate px-1 py-px text-[11px] leading-[13px] font-medium tracking-[0.4px] text-white">
            Custom
          </span>
        ) : null}
      </div>
      <p className="max-w-sm text-sm leading-[21px] tracking-[0.4px] text-wz-strong">
        {s.any ? `On top of the ${roleLabel} role: ${summaryLine(s)}.` : `Inherits all permissions from the ${roleLabel} role.`}
      </p>
      <Link
        href={`/admin/users/${user.id}/permissions`}
        onClick={onClose}
        className="inline-flex h-8 items-center rounded-pill border border-foreground px-3 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground hover:bg-wz-secondary-hover"
      >
        <span className="px-1">{canEdit ? "Manage permissions" : "View permissions"}</span>
      </Link>
    </div>
  );
}
