import { Badge } from "@/components/ui/badge";
import type { TechnicianProfileStatus } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { statusLabel } from "../lib";

/** Pending gets a loud amber treatment — it means "needs a manager". */
export function TechnicianStatusBadge({ status }: { status: TechnicianProfileStatus }) {
  const tone =
    status === "active"
      ? "text-green-600 dark:text-green-500"
      : status === "pending"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-500"
        : "text-muted-foreground";
  const dot =
    status === "active"
      ? "bg-green-500"
      : status === "pending"
        ? "bg-amber-500"
        : "bg-muted-foreground/50";
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", tone)}>
      <span className={cn("size-1.5 rounded-full", dot)} />
      {statusLabel(status)}
    </Badge>
  );
}
