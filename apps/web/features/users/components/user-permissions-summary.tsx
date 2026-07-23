"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { User } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { overrideSummary, type OverrideSummary } from "../overrides";

function summaryLine(s: OverrideSummary): string {
  const parts: string[] = [];
  if (s.permissionCells > 0) {
    parts.push(
      `${s.permissionCells} permission ${s.permissionCells === 1 ? "override" : "overrides"}`,
    );
  }
  if (s.scopeCells > 0) {
    parts.push(`${s.scopeCells} data scope ${s.scopeCells === 1 ? "override" : "overrides"}`);
  }
  if (s.transitionsOverridden) parts.push("custom stage transitions");
  return parts.join(" · ");
}

/** The "Permissions" tab of the user sheet: override status + editor link. */
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
    <div className="flex flex-col items-start gap-3 rounded-lg border p-6">
      <ShieldCheck className="size-6 text-muted-foreground" />
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          Per-user permission overrides
          {s.any ? <Badge variant="outline">Custom</Badge> : null}
        </div>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {s.any
            ? `On top of the ${roleLabel} role: ${summaryLine(s)}.`
            : `Inherits all permissions from the ${roleLabel} role.`}
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/admin/users/${user.id}/permissions`} onClick={onClose}>
          {canEdit ? "Manage permissions" : "View permissions"}
        </Link>
      </Button>
    </div>
  );
}
