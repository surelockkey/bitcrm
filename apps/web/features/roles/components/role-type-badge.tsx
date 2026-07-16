import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Role } from "@bitcrm/types";
import { isSuperAdmin } from "../lib";

/** Type indicator: System (+ Locked for Super Admin) or Custom. */
export function RoleTypeBadge({ role }: { role: Role }) {
  if (isSuperAdmin(role)) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <Badge variant="secondary" className="font-normal">
          System
        </Badge>
        <Badge
          variant="outline"
          className="gap-1 border-amber-500/30 font-normal text-amber-600 dark:text-amber-500"
        >
          <Lock className="size-3" />
          Locked
        </Badge>
      </span>
    );
  }
  if (role.isSystem) {
    return (
      <Badge variant="secondary" className="font-normal">
        System
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="font-normal">
      Custom
    </Badge>
  );
}
