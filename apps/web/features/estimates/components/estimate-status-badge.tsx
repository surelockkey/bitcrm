import type { EstimateStatus } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ESTIMATE_STATUS_META } from "../lib";

export function EstimateStatusBadge({ status, className }: { status: EstimateStatus; className?: string }) {
  const meta = ESTIMATE_STATUS_META[status] ?? ESTIMATE_STATUS_META.unsent;
  return (
    <Badge variant="outline" className={cn("font-medium", meta.className, className)}>
      {meta.label}
    </Badge>
  );
}
